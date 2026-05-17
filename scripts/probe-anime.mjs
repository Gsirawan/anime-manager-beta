#!/usr/bin/env node
// One-shot ANIME probe. AUTH + ANIME aid=X&amask=<DEFAULT_FIELDS> + LOGOUT.
// Prints raw reply, parts count, and labels each field so we can see what
// AniDB actually returns versus what our decoder expects.
//
// Usage (from the repo root, on the mini PC):
//     node scripts/probe-anime.mjs <aid>
//
// Output anatomy:
//   ← REPLY ANIME (NNN bytes): <raw>
//   ── parts (M):
//        [00] aid                 = '...'
//        [01] year                = '...'
//        ...
//        [19] tag_name_list       = '...'
//        [20] tag_id_list         = '...'
//        [21] tag_weight_list     = '...'
//        [22] character_id_list   = '...'   ← (only present if 22 parts)
//
// What to look for:
//   - parts count: must match the number of bits set in amask (22 here)
//   - tag_name_list slot: must contain a string of tag names separated by '
//   - tag_id_list slot: must contain numeric IDs separated by '
//   - character_id_list slot: must contain numeric IDs separated by '
//   - empty slots → AniDB truncated mid-response, or amask request was wrong
//
// Amask hex BCFC9AC10E8000 is what buildAmask(DEFAULT_FIELDS) returns after
// the byte-5 alignment fix (commit 6d70990). Field order below mirrors
// DEFAULT_FIELDS in src/lib/server/anidb/commands/anime.ts.

import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const aidArg = process.argv[2];
if (!aidArg || !/^\d+$/.test(aidArg)) {
	console.error('usage: node scripts/probe-anime.mjs <aid>');
	process.exit(1);
}
const AID = Number(aidArg);

// Must match DEFAULT_FIELDS in src/lib/server/anidb/commands/anime.ts.
// Server returns fields in canonical bit-position order, which this list
// reproduces verbatim.
const FIELD_LABELS = [
	'aid',
	'year',
	'type',
	'related_aid_list',
	'related_aid_type',
	'romaji_name',
	'kanji_name',
	'english_name',
	'other_names',
	'short_name_list',
	'synonym_list',
	'episodes',
	'air_date',
	'end_date',
	'picname',
	'rating',
	'vote_count',
	'is_18_restricted',
	'tag_name_list',
	'tag_id_list',
	'tag_weight_list',
	'character_id_list'
];
const AMASK_HEX = 'BCFC9AC10E8000';

// ── Load .env ───────────────────────────────────────────────────────
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

function sendAndRecv(sock, payload, label) {
	console.log(`→ SEND ${label}: ${redact(payload)}`);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`TIMEOUT waiting for ${label} reply`)),
			TIMEOUT_MS
		);
		sock.once('message', (msg) => {
			clearTimeout(timer);
			console.log(`← REPLY ${label} (${msg.length} bytes):`);
			console.log(`  ${msg.toString('utf8').trim().replace(/\n/g, '\n  ')}`);
			console.log('');
			resolve(msg);
		});
		sock.send(Buffer.from(payload), PORT, HOST, (err) => {
			if (err) {
				clearTimeout(timer);
				reject(err);
			}
		});
	});
}

function firstLineCode(buf) {
	const line = buf.toString('utf8').split('\n')[0].trim();
	const tokens = line.split(/\s+/);
	return { code: Number(tokens[0]), tokens };
}

console.log(`ANIDB probe — aid=${AID}`);
console.log(`  server:     ${HOST}:${PORT}`);
console.log(`  local port: ${LOCAL_PORT}`);
console.log(`  amask:      ${AMASK_HEX}`);
console.log(`  fields (${FIELD_LABELS.length}): ${FIELD_LABELS.join(', ')}`);
console.log('');

const sock = dgram.createSocket('udp4');
sock.on('error', (err) => {
	console.error('socket error:', err);
	process.exit(3);
});
await new Promise((resolve) => sock.bind(LOCAL_PORT, '0.0.0.0', resolve));

let sessionKey = null;
let exitCode = 0;

try {
	// ── AUTH ────────────────────────────────────────────────────────
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
		console.error(`✗ AUTH failed (code ${auth1.code}).`);
		sock.close();
		process.exit(1);
	}
	sessionKey = auth1.tokens[1];
	console.log(`✓ AUTH ok — session key: ${sessionKey}`);
	console.log('');

	// Rate-limit between commands.
	await new Promise((r) => setTimeout(r, 2100));

	// ── ANIME ───────────────────────────────────────────────────────
	const cmd = `ANIME aid=${AID}&amask=${AMASK_HEX}&s=${encodeURIComponent(sessionKey)}`;
	const animeBuf = await sendAndRecv(sock, cmd, 'ANIME');
	const anime1 = firstLineCode(animeBuf);
	if (anime1.code === 330) {
		console.log(`(330 NO SUCH ANIME — aid=${AID} not in AniDB)`);
		exitCode = 4;
	} else if (anime1.code !== 230) {
		console.error(`✗ ANIME failed (code ${anime1.code}).`);
		exitCode = 2;
	} else {
		// Body is the line AFTER the header.
		const text = animeBuf.toString('utf8');
		const lines = text.split('\n');
		const body = lines[1] ?? '';
		console.log(`── header line: ${lines[0]}`);
		console.log(`── body length: ${body.length} chars`);
		console.log(`── body raw (utf8 with \\n preserved):`);
		console.log(body);
		console.log('');

		const parts = body.split('|');
		console.log(`── parts (${parts.length}):`);
		for (let i = 0; i < Math.max(parts.length, FIELD_LABELS.length); i++) {
			const label = FIELD_LABELS[i] ?? '(extra)';
			const value = parts[i] ?? '(missing)';
			// Truncate long values for readability but show enough.
			const display = value.length > 80 ? value.slice(0, 77) + '...' : value;
			console.log(`  [${String(i).padStart(2, '0')}] ${label.padEnd(20)} = '${display}'`);
		}
		console.log('');

		// Diagnostic summary.
		const tagNames = parts[18] ?? '';
		const tagIds = parts[19] ?? '';
		const tagWeights = parts[20] ?? '';
		const charIds = parts[21] ?? '';
		console.log('── decoder simulation:');
		console.log(`  tag_name_list slot length:    ${tagNames.length} chars`);
		console.log(`  tag_id_list slot length:      ${tagIds.length} chars`);
		console.log(`  tag_weight_list slot length:  ${tagWeights.length} chars`);
		console.log(`  character_id_list slot length:${charIds.length} chars`);
		const tagIdParts = tagIds.split("'").filter((s) => s.length > 0);
		const tagIdNumeric = tagIdParts.filter((s) => Number.isFinite(Number(s)));
		console.log(`  tag_id_list parsed numeric:   ${tagIdNumeric.length} / ${tagIdParts.length}`);
		const charIdParts = charIds.split("'").filter((s) => s.length > 0);
		const charIdNumeric = charIdParts.filter((s) => Number.isFinite(Number(s)));
		console.log(`  character_id_list parsed:     ${charIdNumeric.length} / ${charIdParts.length}`);
	}

	await new Promise((r) => setTimeout(r, 2100));

	// ── LOGOUT ──────────────────────────────────────────────────────
	const logout = `LOGOUT s=${encodeURIComponent(sessionKey)}`;
	await sendAndRecv(sock, logout, 'LOGOUT');
} catch (err) {
	console.error(`✗ ${err.message}`);
	exitCode = 3;
} finally {
	sock.close();
}

process.exit(exitCode);
