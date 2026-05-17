import type { UdpTransport } from './transport';
import { parseHeader, REPLY } from './codes';

export interface SessionCreds {
	user: string;
	pass: string;
	client: string;
	clientver: number;
}

/**
 * URL-encode params for an AniDB UDP message body.
 *
 * The AniDB UDP protocol is `CMDNAME<space>key1=val1&key2=val2&…` where
 * VALUES must be URL-encoded. Without encoding, a password containing `&`,
 * `=`, `+`, ` `, etc. corrupts the message and AniDB treats the malformed
 * AUTH as a violation — repeated violations escalate to `555 BANNED Flooding`.
 *
 * Reference: anidb-mv (https://github.com/ljb/anidb-mv) uses Python's
 * urllib.parse.urlencode for the same reason.
 */
function encodeParams(params: Record<string, string | number>): string {
	return Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join('&');
}

/**
 * Append `s=KEY` to an already-built command body.
 *
 * If the command has params (`ANIME aid=123&amask=abc`) we join with `&`.
 * If it has no params (`CALENDAR`) we add the single space and `s=KEY`.
 *
 * The OLD code did `${command} s=${key}` unconditionally — that put TWO
 * spaces in messages like `ANIME aid=123&amask=abc s=KEY`, which is invalid
 * per protocol (only one space between name and params).
 */
function appendSession(command: string, key: string): string {
	const hasParams = command.includes(' ');
	const sep = hasParams ? '&' : ' ';
	return `${command}${sep}s=${encodeURIComponent(key)}`;
}

export class Session {
	key: string | null = null;
	constructor(
		private transport: UdpTransport,
		private creds: SessionCreds
	) {}

	async ensure(): Promise<void> {
		if (this.key) return;
		const cmd = `AUTH ${encodeParams({
			user: this.creds.user,
			pass: this.creds.pass,
			protover: 3,
			client: this.creds.client,
			clientver: this.creds.clientver,
			enc: 'UTF8'
		})}`;
		const reply = await this.transport.send(Buffer.from(cmd));
		const h = parseHeader(reply);
		if (h.code !== REPLY.LOGIN_ACCEPTED && h.code !== REPLY.LOGIN_ACCEPTED_NEW_VER) {
			throw new Error(`AUTH failed: ${h.code} ${h.rest}`);
		}
		// AniDB UDP AUTH response: "200 {session_key} LOGIN ACCEPTED"
		// or "201 {session_key} LOGIN ACCEPTED - NEW VERSION AVAILABLE"
		// Session key is the SECOND whitespace-separated token, immediately after the code.
		const firstLine = reply.toString().split('\n')[0];
		const tokens = firstLine.trim().split(/\s+/);
		this.key = tokens[1] ?? null;
		if (!this.key || this.key.length < 2) {
			throw new Error(`AUTH ok but session key missing or malformed in reply: ${firstLine}`);
		}
	}

	async sendWithSession(command: string): Promise<Buffer> {
		await this.ensure();
		const reply = await this.transport.send(Buffer.from(appendSession(command, this.key!)));
		const h = parseHeader(reply);
		// 506 INVALID_SESSION: session token rejected; clear + re-auth + retry.
		// 501 LOGIN_FIRST: per AniDB UDP spec, "the client should silently
		// resend an auth command and send the failed command again." Same recovery.
		if (h.code === REPLY.INVALID_SESSION || h.code === REPLY.LOGIN_FIRST) {
			this.key = null;
			await this.ensure();
			return this.transport.send(Buffer.from(appendSession(command, this.key!)));
		}
		return reply;
	}

	async logout(): Promise<void> {
		if (!this.key) return;
		await this.transport.send(Buffer.from(`LOGOUT s=${encodeURIComponent(this.key)}`));
		this.key = null;
	}
}
