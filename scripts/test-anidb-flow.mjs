#!/usr/bin/env node
// One-shot AniDB UDP FULL-FLOW test. Sends AUTH → CALENDAR → LOGOUT and
// reports what the server returned at each step.
//
// This is the next rung up from test-anidb-auth.mjs. AUTH succeeding only
// proves the IP/credentials are accepted at session start; the actual
// failure mode we hit before the ban was post-auth commands getting
// rejected (session-key extraction bug + banned source-port history).
// So we send a real command in the same session and check the reply.
//
// CALENDAR is the right command to probe with because:
//   - it's read-only (no AniDB-side state change like MYLISTADD would)
//   - it's already part of the daily cron path — same code path that will
//     run on the mini PC if the ban is truly clear
//   - the reply shape is well-defined: "297 CALENDAR\naid|eptype|epno|airdate"
//
// Usage (from the repo root):
//     node scripts/test-anidb-flow.mjs
//
// Exit codes:
//     0 — full flow worked end to end
//     1 — AUTH failed
//     2 — AUTH ok, CALENDAR failed (the interesting failure mode)
//     3 — timeout at any phase

import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ── Load .env from cwd ──────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
	console.error(`.env not found at ${envPath}. Run from the repo root.`);
	process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
	const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const required = ['ANIDB_USER', 'ANIDB_PASS', 'ANIDB_CLIENT', 'ANIDB_CLIENTVER'];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
	console.error(`missing in .env: ${missing.join(', ')}`);
	process.exit(1);
}

const HOST = env.ANIDB_SERVER || 'api.anidb.net';
const PORT = Number(env.ANIDB_PORT || 9000);
const LOCAL_PORT = Number(env.ANIDB_LOCAL_PORT || 9001);
const TIMEOUT_MS = 15_000;

// ── Helpers ─────────────────────────────────────────────────────────
function encodeParams(params) {
	return Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join('&');
}

function redact(s) {
	return s
		.replace(new RegExp(`pass=${env.ANIDB_PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'pass=***')
		.replace(new RegExp(`user=${env.ANIDB_USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'user=***');
}

// Send one packet, await one reply with timeout.
function sendAndRecv(sock, payload, label) {
	console.log(`→ SEND ${label}: ${redact(payload)}`);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`TIMEOUT waiting for ${label} reply`)),
			TIMEOUT_MS
		);
		sock.once('message', (msg) => {
			clearTimeout(timer);
			const text = msg.toString('utf8');
			console.log(`← REPLY ${label} (${msg.length} bytes):`);
			console.log(`  ${text.trim().replace(/\n/g, '\n  ')}`);
			console.log('');
			resolve(text);
		});
		sock.send(Buffer.from(payload), PORT, HOST, (err) => {
			if (err) {
				clearTimeout(timer);
				reject(err);
			}
		});
	});
}

function firstLineCode(text) {
	const line = text.split('\n')[0].trim();
	const tokens = line.split(/\s+/);
	return { code: Number(tokens[0]), tokens };
}

// ── Run ─────────────────────────────────────────────────────────────
console.log(`AniDB UDP full-flow test`);
console.log(`  server:     ${HOST}:${PORT}`);
console.log(`  local port: ${LOCAL_PORT}`);
console.log(`  client:     ${env.ANIDB_CLIENT} v${env.ANIDB_CLIENTVER}`);
console.log(`  user:       ${env.ANIDB_USER.length} chars`);
console.log(`  pass:       ${env.ANIDB_PASS.length} chars`);
console.log('');

const sock = dgram.createSocket('udp4');
sock.on('error', (err) => {
	console.error('socket error:', err);
	process.exit(3);
});

await new Promise((resolve) => sock.bind(LOCAL_PORT, '0.0.0.0', resolve));
const addr = sock.address();
console.log(`bound to ${addr.address}:${addr.port}`);
console.log('');

let sessionKey = null;
let exitCode = 0;

try {
	// ── 1. AUTH ────────────────────────────────────────────────────
	const auth = `AUTH ${encodeParams({
		user: env.ANIDB_USER,
		pass: env.ANIDB_PASS,
		protover: 3,
		client: env.ANIDB_CLIENT,
		clientver: Number(env.ANIDB_CLIENTVER),
		enc: 'UTF8'
	})}`;
	const authReply = await sendAndRecv(sock, auth, 'AUTH');
	const auth1 = firstLineCode(authReply);
	if (auth1.code !== 200 && auth1.code !== 201) {
		console.error(`✗ AUTH failed (code ${auth1.code}). Aborting flow.`);
		if (auth1.code === 555) console.error('  555 BANNED — IP still banned.');
		if (auth1.code === 500) console.error('  500 LOGIN FAILED — credentials wrong.');
		sock.close();
		process.exit(1);
	}
	sessionKey = auth1.tokens[1];
	console.log(`✓ AUTH ok — session key: ${sessionKey}`);
	console.log('');

	// Rate limit — official spec is 1 packet / 2s. Wait before next.
	await new Promise((r) => setTimeout(r, 2100));

	// ── 2. CALENDAR ────────────────────────────────────────────────
	// AniDB CALENDAR has no extra params. Returns 297 + tab-separated rows.
	//
	// CRITICAL: the protocol separator between command name and params is a
	// SPACE — not `&`. The app's session.ts::appendSession() picks the right
	// separator based on whether the command already has params. For CALENDAR
	// (no params) it's a single space, giving `CALENDAR s=KEY`. Sending
	// `CALENDAR&s=KEY` makes AniDB read `CALENDAR&s` as the command name and
	// return `598 UNKNOWN COMMAND` — that's a probe bug, not a ban.
	const calCmd = `CALENDAR s=${encodeURIComponent(sessionKey)}`;
	let calReply;
	try {
		calReply = await sendAndRecv(sock, calCmd, 'CALENDAR');
	} catch (err) {
		console.error(`✗ CALENDAR ${err.message}`);
		exitCode = 2;
		// fall through to LOGOUT
	}

	if (calReply) {
		const cal1 = firstLineCode(calReply);
		if (cal1.code === 297) {
			const lines = calReply.trim().split('\n').slice(1);
			console.log(`✓ CALENDAR ok — ${lines.length} entries`);
			console.log(`  first 3:`);
			for (const line of lines.slice(0, 3)) console.log(`    ${line}`);
			console.log('');
		} else {
			console.error(`✗ CALENDAR returned code ${cal1.code} (expected 297).`);
			if (cal1.code === 555) console.error('  555 BANNED on commands — AUTH ok but server still blocking.');
			if (cal1.code === 501) console.error('  501 LOGIN FIRST — session key not accepted (bug in our request).');
			if (cal1.code === 502) console.error('  502 ACCESS DENIED — session expired or invalid.');
			exitCode = 2;
		}
	}

	// Rate limit before LOGOUT.
	await new Promise((r) => setTimeout(r, 2100));

	// ── 3. LOGOUT ──────────────────────────────────────────────────
	const logout = `LOGOUT s=${encodeURIComponent(sessionKey)}`;
	const logoutReply = await sendAndRecv(sock, logout, 'LOGOUT');
	const log1 = firstLineCode(logoutReply);
	if (log1.code === 203) {
		console.log('✓ LOGOUT ok — session cleanly terminated.');
	} else {
		console.log(`(logout reply code ${log1.code} — non-203 but session is dead either way)`);
	}
} catch (err) {
	console.error(`✗ ${err.message}`);
	exitCode = 3;
} finally {
	sock.close();
}

console.log('');
console.log(exitCode === 0 ? '═══ full flow PASS ═══' : `═══ full flow FAIL (exit ${exitCode}) ═══`);
process.exit(exitCode);
