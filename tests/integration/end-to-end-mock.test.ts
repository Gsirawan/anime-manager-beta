/**
 * End-to-end integration test against the local UDP mock.
 *
 * Spawns scripts/fake-anidb-server.mjs as a child process, captures the
 * port it bound, wires a REAL DgramTransport + Session + RateLimiter at
 * it, and drives the animeFetch handler through one full lifecycle.
 *
 * What this proves that FakeTransport tests cannot:
 *   - The dgram socket actually sends/receives bytes over the loopback.
 *   - Session AUTH parses the mock's `200 <key> LOGIN ACCEPTED` correctly.
 *   - The amask hex we compute against AMASK_FIELDS in amask.ts maps to
 *     the same field set the mock decodes (catches AMASK drift between
 *     the two — they MUST stay in lockstep, see CLAUDE.md).
 *   - Per-field list separators round-trip: synonym/short split on "'",
 *     tag/char/related split on ",".
 *   - Persistence layer writes the expected rows for a real wire payload.
 *
 * If this test fails, either the mock drifted, the amask drifted, or
 * the splitter helpers drifted. Compare the printed body against
 * AMASK_FIELDS in src/lib/server/anidb/amask.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import pino from 'pino';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DgramTransport } from '../../src/lib/server/anidb/transport';
import { Session } from '../../src/lib/server/anidb/session';
import { RateLimiter } from '../../src/lib/server/anidb/rateLimiter';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { animeFetch } from '../../src/lib/server/jobs/handlers/animeFetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockScript = path.resolve(__dirname, '../../scripts/fake-anidb-server.mjs');

describe('end-to-end: real DgramTransport → fake-anidb-server', () => {
	let mock: ChildProcess;
	let mockPort: number;

	beforeAll(async () => {
		// Spawn the mock on an ephemeral port (`--port 0` → OS-assigned).
		// Parse the listening line from stdout to learn which port it got.
		mock = spawn('node', [mockScript, '--port', '0', '--host', '127.0.0.1'], {
			stdio: ['ignore', 'pipe', 'pipe']
		});
		mockPort = await new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('mock did not start within 5 s')), 5_000);
			mock.stdout?.on('data', (chunk: Buffer) => {
				const text = chunk.toString('utf8');
				const m = text.match(/udp:\/\/127\.0\.0\.1:(\d+)/);
				if (m) {
					clearTimeout(timer);
					resolve(Number(m[1]));
				}
			});
			mock.stderr?.on('data', (chunk: Buffer) => {
				// Surface any startup error.
				process.stderr.write(`[mock stderr] ${chunk.toString('utf8')}`);
			});
			mock.on('error', reject);
			mock.on('exit', (code) => {
				if (code !== 0 && code !== null)
					reject(new Error(`mock exited prematurely with code ${code}`));
			});
		});
	});

	afterAll(() => {
		if (mock && !mock.killed) mock.kill('SIGTERM');
	});

	it('runs animeFetch end-to-end and persists all rows correctly', async () => {
		// Real DgramTransport — binds an ephemeral local port (0) since the
		// fixed 9001 might be in use by a dev instance of the worker.
		const db: BetterSqlite3.Database = new Database(':memory:');
		runMigrations(db);
		// Seed titles_dump for the gate path used by some downstream queries.
		db.prepare(
			`INSERT INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)`
		).run(42, 'x-jat', 'main', 'Mock Romaji 42');

		// RateLimiter at 0 ms — the 4 s production spacing isn't needed when
		// talking to localhost, and stretching the test to 8 s+ for a single
		// AUTH+ANIME+ANIMEDESC round-trip wastes the suite's time budget.
		const rateLimiter = new RateLimiter({ intervalMs: 0 });
		const transport = new DgramTransport('127.0.0.1', mockPort, rateLimiter, 0);
		const session = new Session(transport, {
			user: 'mock-user',
			pass: 'mock-pass',
			client: 'integration-test',
			clientver: 1
		});

		const ctx = {
			db,
			session,
			rateLimiter,
			log: pino({ level: 'silent' }),
			banAttempt: 0,
			lastBanAt: 0
		} as never;

		try {
			await animeFetch({ aid: 42 }, ctx);

			// ── anime row ──
			const row = db.prepare(`SELECT * FROM anime WHERE aid = 42`).get() as
				| { aid: number; type: string; episode_count: number; year: number; picname: string; rating: number; restricted: number; fetched_at: number }
				| undefined;
			expect(row).toBeDefined();
			expect(row?.type).toBe('TV Series');
			expect(row?.episode_count).toBe(12);
			expect(row?.year).toBe(2024);
			expect(row?.picname).toBe('mock-42.jpg');
			expect(row?.rating).toBeCloseTo(8.0);
			expect(row?.restricted).toBe(0);
			expect(row?.fetched_at).toBeGreaterThan(0);

			// ── titles: 3 singletons + 1 other + 2 shorts + 3 synonyms = 9 ──
			const titles = db
				.prepare(`SELECT lang, type, title FROM anime_title WHERE aid = 42 ORDER BY type, lang, title`)
				.all() as { lang: string; type: string; title: string }[];
			// Mains: romaji (x-jat), kanji (ja), english (en) — all single values.
			expect(titles.some((t) => t.lang === 'x-jat' && t.type === 'main' && t.title === 'Mock Romaji 42')).toBe(true);
			expect(titles.some((t) => t.lang === 'ja' && t.type === 'main' && t.title === 'モック 42')).toBe(true);
			expect(titles.some((t) => t.lang === 'en' && t.type === 'main' && t.title === 'Mock English 42')).toBe(true);
			// Other (single per spec): one row.
			const others = titles.filter((t) => t.type === 'other');
			expect(others.length).toBe(1);
			expect(others[0].title).toBe('Mock Other 42');
			// Shorts (apostrophe-split): MA42'MOCK42 → 2 rows.
			const shorts = titles.filter((t) => t.type === 'short');
			expect(shorts.length).toBe(2);
			expect(shorts.map((s) => s.title).sort()).toEqual(['MA42', 'MOCK42']);
			// Synonyms (apostrophe-split): 3 rows.
			const synonyms = titles.filter((t) => t.type === 'synonym');
			expect(synonyms.length).toBe(3);
			expect(synonyms.map((s) => s.title)).toContain('Mock Syn A 42');
			expect(synonyms.map((s) => s.title)).toContain('Mock Syn B 42');
			expect(synonyms.map((s) => s.title)).toContain('Mock Syn C 42');

			// ── tags (comma-split): 4 from mock canned data ──
			const tags = db
				.prepare(`SELECT tag_id, tag_name, weight FROM anime_tag WHERE aid = 42 ORDER BY weight DESC`)
				.all() as { tag_id: number; tag_name: string; weight: number }[];
			expect(tags.length).toBe(4);
			expect(tags[0].tag_id).toBe(100);
			expect(tags[0].tag_name).toBe('Japanese production');
			expect(tags[0].weight).toBe(600);

			// ── characters (comma-split): 3 from mock canned data ──
			const chars = db
				.prepare(`SELECT char_id FROM anime_character WHERE aid = 42 ORDER BY char_id`)
				.all() as { char_id: number }[];
			expect(chars.map((c) => c.char_id)).toEqual([1001, 1002, 1003]);

			// ── relations (comma-split): 2 from mock canned data ──
			const rels = db
				.prepare(`SELECT related_aid, type FROM anime_relation WHERE aid = 42 ORDER BY related_aid`)
				.all() as { related_aid: number; type: string }[];
			expect(rels.length).toBe(2);
			expect(rels[0].related_aid).toBe(2);
			expect(rels[1].related_aid).toBe(3);

			// ── classifyOrigin should KEEP (Japanese production tag) ──
			const tomb = db.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_42'`).get();
			expect(tomb).toBeUndefined();

			// ── follow-up anime_desc_fetch enqueued ──
			const desc = db
				.prepare(`SELECT params_json FROM job WHERE kind = 'anime_desc_fetch' AND status = 'pending'`)
				.get() as { params_json: string } | undefined;
			expect(desc).toBeDefined();
			expect(JSON.parse(desc!.params_json)).toEqual({ aid: 42 });
		} finally {
			await transport.close();
		}
	});

	it('tombstones non-Japanese origin via classifyOrigin (aid 80000+ in mock)', async () => {
		const db: BetterSqlite3.Database = new Database(':memory:');
		runMigrations(db);
		const rateLimiter = new RateLimiter({ intervalMs: 0 });
		const transport = new DgramTransport('127.0.0.1', mockPort, rateLimiter, 0);
		const session = new Session(transport, {
			user: 'mock-user',
			pass: 'mock-pass',
			client: 'integration-test',
			clientver: 1
		});
		const ctx = {
			db,
			session,
			rateLimiter,
			log: pino({ level: 'silent' }),
			banAttempt: 0,
			lastBanAt: 0
		} as never;

		try {
			await animeFetch({ aid: 80001 }, ctx);
			const tomb = db
				.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_80001'`)
				.get() as { value: string } | undefined;
			expect(tomb?.value).toMatch(/^non_japanese\|\d+$/);
			// Anime row still persisted — tombstone is a UI filter, not a delete.
			const row = db.prepare(`SELECT aid FROM anime WHERE aid = 80001`).get();
			expect(row).toBeDefined();
			// No anime_desc_fetch follow-up for tombstoned aids.
			const desc = db
				.prepare(`SELECT COUNT(*) AS n FROM job WHERE kind = 'anime_desc_fetch'`)
				.get() as { n: number };
			expect(desc.n).toBe(0);
		} finally {
			await transport.close();
		}
	});
});
