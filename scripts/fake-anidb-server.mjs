#!/usr/bin/env node
/**
 * Local AniDB UDP mock server.
 *
 * Listens on UDP and replies with canned-but-protocol-faithful data so the
 * worker, rate limiter, session retry, ban-detection regex, and persistence
 * layer can be exercised end-to-end without burning real packets at AniDB.
 *
 * Why this exists:
 *   AniDB has no sandbox / staging environment by design (docs/udp-docs.md
 *   § Anti-Leech). The short-term rate cap is 1 packet / 2 s, the long-term
 *   cap is 1 packet / 4 s, bans are aggressive (~30 min default, indefinite
 *   for "abusive" clients per docs line 170), and "dropped packets are still
 *   taken into account" — meaning you can extend a ban just by retrying
 *   wrong (docs line 164). Iterating on the worker against real AniDB is
 *   genuinely dangerous.
 *
 *   FakeTransport in src/lib/server/anidb/transport.ts covers unit tests
 *   well, but doesn't exercise the dgram socket, the rate limiter timing,
 *   or the ban-detection error paths. The mock fills that gap.
 *
 * Protocol fidelity points (per docs/udp-docs.md):
 *   - Command form: `CMDNAME key1=val1&key2=val2[&s=KEY]` with a single
 *     space between command name and params (line 38 + the session.ts
 *     appendSession comment).
 *   - Values are URL-encoded — we decode on parse.
 *   - Replies are line-terminated by `\n` (line 80) with no CR.
 *   - The reply header is `{int code} {str text}`. Some codes prepend a
 *     data token to the header line (200/201 add the session key — see
 *     docs line 237; the worker depends on this in session.ts).
 *   - ANIME reply fields are pipe-separated in canonical amask bit-position
 *     order ("byte 1, bit 7 first" — line 856).
 *   - In-field list separator depends on the field (lines 857-858):
 *       * Synonyms / short names → "'" (apostrophe)
 *       * Categories             → ","
 *     The 2026-05-16 wire probe confirmed tag_*, character_id_list, and
 *     related_aid_* are also ",". This mock follows the same rule.
 *   - Truncation hierarchy on response too large for one UDP packet:
 *     "character id list first, then tag list, synonym list, short name
 *     list" (line 871). The mock does NOT simulate truncation by default
 *     — payloads are well under 1400 bytes — but the --truncate flag can
 *     force it for testing the truncation-detection path (TODO if needed).
 *
 * Usage:
 *
 *   # Default — listens on 127.0.0.1:9000.
 *   node scripts/fake-anidb-server.mjs
 *
 *   # In another shell, point the app at it via .env:
 *   #   ANIDB_SERVER=127.0.0.1
 *   #   ANIDB_PORT=9000
 *   #   ANIDB_LOCAL_PORT=9001
 *   # (Leaving ANIDB_USER and ANIDB_PASS as anything works — the mock
 *   #  accepts any AUTH unless --hard-ban or --maintenance is set.)
 *
 *   # Simulate a flood ban after 50 packets:
 *   node scripts/fake-anidb-server.mjs --ban-after 50
 *
 *   # Simulate silent-drop ban after 50 packets (tests udp-timeout path):
 *   node scripts/fake-anidb-server.mjs --silent-after 50
 *
 *   # Permanent ban on AUTH:
 *   node scripts/fake-anidb-server.mjs --hard-ban
 *
 *   # Daily maintenance window:
 *   node scripts/fake-anidb-server.mjs --maintenance
 *
 *   # Force a session to become invalid after N commands (tests re-auth):
 *   node scripts/fake-anidb-server.mjs --invalidate-after 5
 *
 *   # Add artificial reply latency (tests timeout handling without socket dropping):
 *   node scripts/fake-anidb-server.mjs --latency 500
 *
 * Logs every packet in/out to stdout with a serial number so you can see
 * exactly what the worker sent and what the mock returned. Sensitive
 * fields (pass=) are redacted.
 */

import dgram from 'node:dgram';
import process from 'node:process';

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, def) {
	const i = args.indexOf(name);
	return i === -1 ? def : args[i + 1];
}
function flag(name) {
	return args.includes(name);
}
function num(name, def) {
	const v = arg(name);
	return v === undefined ? def : Number(v);
}

const PORT = num('--port', 9000);
const HOST = arg('--host', '127.0.0.1');
const BAN_AFTER = num('--ban-after', Infinity);
const SILENT_AFTER = num('--silent-after', Infinity);
const INVALIDATE_AFTER = num('--invalidate-after', Infinity);
const HARD_BAN = flag('--hard-ban');
const MAINTENANCE = flag('--maintenance');
const LATENCY = num('--latency', 0);

let packetCount = 0;
let commandCount = 0; // for INVALIDATE_AFTER
const sessions = new Map(); // key → { user, createdAt }

// ── AMASK_FIELDS ────────────────────────────────────────────────────
// MUST stay in lockstep with src/lib/server/anidb/amask.ts. 56 entries.
// Indexed 0..55: idx 0 = byte 0 bit 7, idx 7 = byte 0 bit 0, etc.
const AMASK_FIELDS = [
	// byte 1
	'aid', 'dateflags', 'year', 'type', 'related_aid_list', 'related_aid_type', 'category_list', 'reserved_1_0',
	// byte 2
	'romaji_name', 'kanji_name', 'english_name', 'other_names', 'short_name_list', 'synonym_list', 'reserved_2_1', 'reserved_2_0',
	// byte 3
	'episodes', 'highest_episode_number', 'special_ep_count', 'air_date', 'end_date', 'url', 'picname', 'category_id_list',
	// byte 4
	'rating', 'vote_count', 'temp_rating', 'temp_vote_count', 'average_review_rating', 'review_count', 'award_list', 'is_18_restricted',
	// byte 5
	'reserved_5_7', 'ann_id', 'allcinema_id', 'animenfo_id', 'tag_name_list', 'tag_id_list', 'tag_weight_list', 'date_record_updated',
	// byte 6
	'character_id_list', 'reserved_6_6', 'reserved_6_5', 'reserved_6_4', 'reserved_6_3', 'reserved_6_2', 'reserved_6_1', 'reserved_6_0',
	// byte 7
	'specials_count', 'credits_count', 'other_count', 'trailer_count', 'parody_count', 'reserved_7_2', 'reserved_7_1', 'reserved_7_0'
];

// ── Canned data per field ───────────────────────────────────────────
// Deterministic mock data keyed by aid so tests are reproducible. NSFW
// (is_18_restricted=1) is triggered for aid >= 90000. Origin tag is
// "Japanese production" by default; aid >= 80000 returns "Korean production"
// so the classifyOrigin tombstone path can be exercised.
function fieldValue(field, aid) {
	switch (field) {
		case 'aid': return String(aid);
		case 'dateflags': return '0';
		case 'year': return '2024-2024';
		case 'type': return 'TV Series';
		case 'related_aid_list': return '2,3';                    // COMMA
		case 'related_aid_type': return '1,2';                    // COMMA
		case 'category_list': return '';                          // deprecated
		case 'romaji_name': return `Mock Romaji ${aid}`;
		case 'kanji_name': return `モック ${aid}`;
		case 'english_name': return `Mock English ${aid}`;
		case 'other_names': return `Mock Other ${aid}`;           // singular per spec
		case 'short_name_list': return `MA${aid}'MOCK${aid}`;     // APOSTROPHE
		case 'synonym_list':                                       // APOSTROPHE
			return `Mock Syn A ${aid}'Mock Syn B ${aid}'Mock Syn C ${aid}`;
		case 'episodes': return '12';
		case 'highest_episode_number': return '12';
		case 'special_ep_count': return '0';
		case 'air_date': return '1704067200';                     // 2024-01-01
		case 'end_date': return '1711929600';                     // 2024-04-01
		case 'url': return '';
		case 'picname': return `mock-${aid}.jpg`;
		case 'category_id_list': return '';
		case 'rating': return '800';                              // 8.00
		case 'vote_count': return '1000';
		case 'temp_rating': return '750';
		case 'temp_vote_count': return '50';
		case 'average_review_rating': return '0';
		case 'review_count': return '0';
		case 'award_list': return '';
		case 'is_18_restricted': return aid >= 90000 ? '1' : '0';
		case 'ann_id': return '1';
		case 'allcinema_id': return '1';
		case 'animenfo_id': return '1';
		case 'tag_name_list':                                      // COMMA
			return aid >= 80000 && aid < 90000
				? 'Korean production,Action,Drama'
				: 'Japanese production,Action,Adventure,Sci-Fi';
		case 'tag_id_list': return '100,200,300,400';             // COMMA
		case 'tag_weight_list': return '600,500,400,300';         // COMMA
		case 'date_record_updated': return '1700000000';
		case 'character_id_list': return '1001,1002,1003';        // COMMA
		case 'specials_count': return '0';
		case 'credits_count': return '0';
		case 'other_count': return '0';
		case 'trailer_count': return '0';
		case 'parody_count': return '0';
		default: return ''; // reserved_* → empty
	}
}

// Decode hex amask → list of fields in canonical bit-position order.
function fieldsForAmask(amaskHex) {
	if (amaskHex.length !== 14) return [];
	const bytes = [];
	for (let i = 0; i < 14; i += 2) {
		bytes.push(parseInt(amaskHex.substr(i, 2), 16));
	}
	const out = [];
	for (let byteIdx = 0; byteIdx < bytes.length; byteIdx++) {
		for (let bit = 7; bit >= 0; bit--) {
			if (bytes[byteIdx] & (1 << bit)) {
				const fieldIdx = byteIdx * 8 + (7 - bit);
				out.push(AMASK_FIELDS[fieldIdx]);
			}
		}
	}
	return out;
}

// ── Command parsing ─────────────────────────────────────────────────
function parseCommand(buf) {
	const text = buf.toString('utf8').trim();
	const spIdx = text.indexOf(' ');
	const cmd = spIdx === -1 ? text : text.slice(0, spIdx);
	const paramStr = spIdx === -1 ? '' : text.slice(spIdx + 1);
	const params = {};
	for (const part of paramStr.split('&')) {
		if (!part) continue;
		const eq = part.indexOf('=');
		if (eq > 0) {
			const k = part.slice(0, eq);
			const v = part.slice(eq + 1);
			try {
				params[k] = decodeURIComponent(v);
			} catch {
				params[k] = v;
			}
		}
	}
	return { cmd, params, raw: text };
}

function redact(text) {
	return text.replace(/(pass=)[^&\s]+/g, '$1***').replace(/(s=)[^&\s]+/g, '$1***');
}

// ── Handlers ────────────────────────────────────────────────────────
function freshSessionKey() {
	// 8 alnum chars to match AniDB's typical key length.
	return Array.from({ length: 8 }, () =>
		'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
	).join('');
}

function requireSession(params) {
	if (!params.s) return { ok: false, body: '501 LOGIN FIRST\n' };
	if (!sessions.has(params.s)) return { ok: false, body: '506 INVALID SESSION\n' };
	commandCount++;
	if (commandCount > INVALIDATE_AFTER) {
		sessions.delete(params.s);
		return { ok: false, body: '506 INVALID SESSION\n' };
	}
	return { ok: true };
}

function handle({ cmd, params }) {
	switch (cmd) {
		case 'AUTH': {
			if (HARD_BAN) return '504 CLIENT BANNED - simulated by fake-anidb-server\n';
			if (MAINTENANCE) return '601 ANIDB OUT OF SERVICE - TRY AGAIN LATER\n';
			if (!params.user || !params.pass) return '500 LOGIN FAILED\n';
			const key = freshSessionKey();
			sessions.set(key, { user: params.user, createdAt: Date.now() });
			return `200 ${key} LOGIN ACCEPTED\n`;
		}
		case 'LOGOUT': {
			if (params.s) sessions.delete(params.s);
			return '203 LOGGED OUT\n';
		}
		case 'PING': {
			return '300 PONG\n';
		}
		case 'ANIME': {
			const g = requireSession(params);
			if (!g.ok) return g.body;
			const aid = Number(params.aid);
			if (!Number.isFinite(aid) || aid <= 0) return '505 ILLEGAL INPUT OR ACCESS DENIED\n';
			if (aid === 999999) return '330 NO SUCH ANIME\n';
			const fields = fieldsForAmask(params.amask ?? '');
			if (fields.length === 0) return '505 ILLEGAL INPUT OR ACCESS DENIED\n';
			const body = fields.map((f) => fieldValue(f, aid)).join('|');
			return `230 ANIME\n${body}\n`;
		}
		case 'ANIMEDESC': {
			const g = requireSession(params);
			if (!g.ok) return g.body;
			const aid = Number(params.aid);
			const part = Number(params.part ?? 0);
			if (aid === 999999) return '330 NO SUCH ANIME\n';
			// Single-part mock description. Format: current|total|desc
			return `233 ANIMEDESC\n${part}|1|Mock description for aid=${aid} part=${part}.\n`;
		}
		case 'UPDATED': {
			const g = requireSession(params);
			if (!g.ok) return g.body;
			const now = Math.floor(Date.now() / 1000);
			// {entity}|{count}|{last_update}|{aid,aid,...}
			return `243 UPDATED\n1|5|${now}|1,2,3,4,5\n`;
		}
		case 'MYLISTADD': {
			const g = requireSession(params);
			if (!g.ok) return g.body;
			if (params.edit === '1') return '311 MYLIST ENTRY EDITED\n';
			// Per AniDB animeinfo add: 210 + {entry-count}, NOT a lid.
			return '210 MYLIST ENTRY ADDED\n1\n';
		}
		case 'MYLISTDEL': {
			const g = requireSession(params);
			if (!g.ok) return g.body;
			return '211 MYLIST ENTRY DELETED\n';
		}
		default:
			return `598 UNKNOWN COMMAND\n`;
	}
}

// ── Socket ──────────────────────────────────────────────────────────
const sock = dgram.createSocket('udp4');

sock.on('error', (err) => {
	console.error('socket error:', err.message);
	process.exit(1);
});

sock.on('message', (msg, rinfo) => {
	packetCount++;
	const n = packetCount;
	const { cmd, params, raw } = parseCommand(msg);

	console.log(`← #${n} ${rinfo.address}:${rinfo.port}  ${redact(raw)}`);

	// Silent-drop simulation — no reply at all (tests `udp timeout`).
	if (packetCount > SILENT_AFTER) {
		console.log(`  (silent drop, count > ${SILENT_AFTER})`);
		return;
	}

	let reply;
	if (packetCount > BAN_AFTER) {
		reply = '555 BANNED Flooding\n';
		console.log(`  → simulated flood ban (count > ${BAN_AFTER})`);
	} else {
		reply = handle({ cmd, params });
	}

	const send = () => {
		sock.send(Buffer.from(reply), rinfo.port, rinfo.address, (err) => {
			if (err) console.error(`  ! send error: ${err.message}`);
		});
		console.log(`→ #${n} ${reply.trim().replace(/\n/g, '\\n')}`);
	};
	if (LATENCY > 0) setTimeout(send, LATENCY);
	else send();
});

sock.bind(PORT, HOST, () => {
	const addr = sock.address();
	console.log(`fake-anidb listening on udp://${addr.address}:${addr.port}`);
	const flags = [];
	if (BAN_AFTER !== Infinity) flags.push(`ban-after=${BAN_AFTER}`);
	if (SILENT_AFTER !== Infinity) flags.push(`silent-after=${SILENT_AFTER}`);
	if (INVALIDATE_AFTER !== Infinity) flags.push(`invalidate-after=${INVALIDATE_AFTER}`);
	if (HARD_BAN) flags.push('hard-ban');
	if (MAINTENANCE) flags.push('maintenance');
	if (LATENCY > 0) flags.push(`latency=${LATENCY}ms`);
	console.log(`flags: ${flags.length ? flags.join(', ') : '(none — normal operation)'}`);
	console.log(`point your client at: ANIDB_SERVER=${addr.address} ANIDB_PORT=${addr.port}`);
});

process.on('SIGINT', () => {
	console.log('\nfake-anidb shutting down');
	sock.close(() => process.exit(0));
});
process.on('SIGTERM', () => sock.close(() => process.exit(0)));
