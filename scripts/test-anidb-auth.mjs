#!/usr/bin/env node
// One-shot AniDB UDP AUTH test. Sends EXACTLY ONE AUTH packet, reads the
// reply, prints the result, sends LOGOUT if AUTH succeeded, exits.
//
// Use this to verify your .env credentials without booting the app.
// The full app retries on failure, which can stack into a 555 Excessive
// ban. This script never retries.
//
// Usage (from the repo root):
//     node scripts/test-anidb-auth.mjs
//
// Exit codes:
//     0 — AUTH succeeded
//     1 — AUTH failed (wrong creds, banned, etc.)
//     2 — timeout (network or AniDB unresponsive)

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

// ── Run ─────────────────────────────────────────────────────────────
console.log(`AniDB AUTH test`);
console.log(`  server:     ${HOST}:${PORT}`);
console.log(`  local port: ${LOCAL_PORT}`);
console.log(`  client:     ${env.ANIDB_CLIENT} v${env.ANIDB_CLIENTVER}`);
console.log(`  user:       ${env.ANIDB_USER.length} chars`);
console.log(`  pass:       ${env.ANIDB_PASS.length} chars`);
console.log('');

const sock = dgram.createSocket('udp4');
let sessionKey = null;
let phase = 'auth'; // 'auth' or 'logout'

const timer = setTimeout(() => {
	console.error('\n✗ TIMEOUT — no reply from AniDB in 15s.');
	console.error('  Either the server is unresponsive or the packet did not get through.');
	sock.close();
	process.exit(2);
}, 15_000);

sock.on('error', (err) => {
	clearTimeout(timer);
	console.error('socket error:', err);
	process.exit(1);
});

sock.on('message', (msg) => {
	const text = msg.toString('utf8');
	console.log(`← REPLY (${msg.length} bytes):`);
	console.log(`  ${text.trim().replace(/\n/g, '\n  ')}`);
	console.log('');

	const firstLine = text.split('\n')[0].trim();
	const tokens = firstLine.split(/\s+/);
	const code = Number(tokens[0]);

	if (phase === 'auth') {
		if (code === 200 || code === 201) {
			sessionKey = tokens[1];
			console.log(`✓ AUTH succeeded. Session key: ${sessionKey}`);
			console.log(`  → Sending LOGOUT to clean up the session…`);
			phase = 'logout';
			const logout = `LOGOUT s=${encodeURIComponent(sessionKey)}`;
			sock.send(Buffer.from(logout), PORT, HOST, (err) => {
				if (err) {
					console.error('logout send failed:', err);
					clearTimeout(timer);
					sock.close();
					process.exit(0);
				}
			});
		} else {
			console.error(`✗ AUTH failed with code ${code}.`);
			if (code === 500) {
				console.error('  500 LOGIN FAILED — username or password rejected by AniDB.');
				console.error('  Verify ANIDB_USER and ANIDB_PASS in .env match your AniDB account.');
			} else if (code === 555) {
				console.error('  555 BANNED — IP is currently banned. Wait at least 30 min from the LAST attempt.');
			} else if (code === 503) {
				console.error('  503 CLIENT VERSION OUTDATED — increment ANIDB_CLIENTVER in .env.');
			} else if (code === 505) {
				console.error('  505 ILLEGAL INPUT — malformed packet. Open a bug.');
			} else if (code === 601) {
				console.error('  601 AniDB OUT OF SERVICE — try again later (not your fault).');
			}
			clearTimeout(timer);
			sock.close();
			process.exit(1);
		}
	} else if (phase === 'logout') {
		if (code === 203) {
			console.log('✓ Logged out cleanly.');
		} else {
			console.log(`(logout reply code ${code} — non-203 but session is dead either way)`);
		}
		clearTimeout(timer);
		sock.close();
		process.exit(0);
	}
});

sock.bind(LOCAL_PORT, '0.0.0.0', () => {
	const addr = sock.address();
	console.log(`bound to ${addr.address}:${addr.port}`);
	const auth = `AUTH ${encodeParams({
		user: env.ANIDB_USER,
		pass: env.ANIDB_PASS,
		protover: 3,
		client: env.ANIDB_CLIENT,
		clientver: Number(env.ANIDB_CLIENTVER),
		enc: 'UTF8'
	})}`;
	console.log(`→ SEND: ${redact(auth)}`);
	console.log('');
	sock.send(Buffer.from(auth), PORT, HOST, (err) => {
		if (err) {
			clearTimeout(timer);
			console.error('send failed:', err);
			process.exit(1);
		}
	});
});
