import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { RateLimiter } from '../../src/lib/server/anidb/rateLimiter';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { enqueue, pendingCount } from '../../src/lib/server/db/repositories/jobs';
import { runWorkerOnce, hydrateWorkerContext } from '../../src/lib/server/jobs/worker';
import { setMeta, getMeta } from '../../src/lib/server/db/repositories/meta';

function seedTitle(db: any, aid: number) {
	db.prepare(`INSERT INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)`).run(
		aid,
		'x-jat',
		'main',
		'Test Title'
	);
}

describe('runWorkerOnce', () => {
	it('claims a job, calls the handler, marks done', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 1);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 1 }, priority: 1 });

		const called: Array<[string, unknown]> = [];
		const handlers = {
			anime_fetch: async (params: unknown) => {
				called.push(['anime_fetch', params]);
			}
		} as any;

		const acquired: number[] = [];
		const rateLimiter = {
			pausedUntil: 0,
			acquire: async () => {
				acquired.push(Date.now());
			},
			penalty: () => {},
			hydrate: () => {}
		} as any;

		const result = await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter,
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			handlers
		);

		expect(result).toBe('processed');
		expect(called[0][0]).toBe('anime_fetch');
		expect(called[0][1]).toEqual({ aid: 1 });
		expect(pendingCount(db)).toBe(0);
		// Worker no longer acquires the rate limiter directly — the transport does,
		// per UDP packet. The worker only applies ban penalties on 555/BANNED.
		expect(acquired.length).toBe(0);
	});

	it('returns "idle" when no jobs are pending', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const result = await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter: {
					pausedUntil: 0,
					acquire: async () => {},
					penalty: () => {},
					hydrate: () => {}
				} as any,
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			{} as any
		);
		expect(result).toBe('idle');
	});
});

describe('runWorkerOnce ban handling', () => {
	// First-rung backoff: 30 minutes (1_800_000 ms). Verifies we don't poke
	// AniDB at the old 30 s cadence while a flood ban is still active.
	const FIRST_RUNG_MS = 30 * 60 * 1000;

	it('triggers rate limiter penalty on errors mentioning 555 BANNED', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 1);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 1 }, priority: 1 });
		const rl = new RateLimiter({ intervalMs: 4000 });
		const t0 = Date.now();
		const handlers = {
			anime_fetch: async () => {
				throw new Error('AniDB reply: 555 BANNED');
			}
		} as any;
		await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter: rl,
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			handlers
		);
		// First-rung pause must be at least 30 min (allow a few ms scheduling
		// slack on the lower bound).
		expect(rl.pausedUntil).toBeGreaterThanOrEqual(t0 + FIRST_RUNG_MS - 100);
	});

	it('triggers ban backoff on `udp timeout` (silent-drop ban)', async () => {
		// Per docs line 162, rate-limit violations cause silent packet drops
		// — no 555 reply, just no reply. Our transport surfaces that as
		// `udp timeout`. If we don't treat it as a ban signal we keep firing
		// packets at a silent ban and extend it.
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 7);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 7 }, priority: 1 });
		const rl = new RateLimiter({ intervalMs: 4000 });
		const t0 = Date.now();
		const handlers = {
			anime_fetch: async () => {
				throw new Error('udp timeout');
			}
		} as any;
		await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter: rl,
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			handlers
		);
		expect(rl.pausedUntil).toBeGreaterThanOrEqual(t0 + FIRST_RUNG_MS - 100);
	});

	it('triggers ban backoff on 601 ANIDB OUT OF SERVICE (daily maintenance)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 8);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 8 }, priority: 1 });
		const rl = new RateLimiter({ intervalMs: 4000 });
		const t0 = Date.now();
		const handlers = {
			anime_fetch: async () => {
				throw new Error('AUTH failed: 601 ANIDB OUT OF SERVICE - TRY AGAIN LATER');
			}
		} as any;
		await runWorkerOnce(
			{ db, session: null as any, rateLimiter: rl, log: pino({ level: 'silent' }), banAttempt: 0, lastBanAt: 0 },
			handlers
		);
		// 30 min minimum per docs line 110.
		expect(rl.pausedUntil).toBeGreaterThanOrEqual(t0 + FIRST_RUNG_MS - 100);
	});

	it('triggers ban backoff on 604 TIMEOUT (explicit server reply, distinct from socket timeout)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 9);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 9 }, priority: 1 });
		const rl = new RateLimiter({ intervalMs: 4000 });
		const t0 = Date.now();
		const handlers = {
			anime_fetch: async () => {
				throw new Error('ANIME failed: 604 TIMEOUT - DELAY AND RESUBMIT');
			}
		} as any;
		await runWorkerOnce(
			{ db, session: null as any, rateLimiter: rl, log: pino({ level: 'silent' }), banAttempt: 0, lastBanAt: 0 },
			handlers
		);
		expect(rl.pausedUntil).toBeGreaterThanOrEqual(t0 + FIRST_RUNG_MS - 100);
	});

	it('hard-stops on 504 CLIENT BANNED (account-level, requires manual unban)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 100);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 100 }, priority: 1 });
		const rl = new RateLimiter({ intervalMs: 4000 });
		const t0 = Date.now();
		const handlers = {
			anime_fetch: async () => {
				throw new Error('AUTH failed: 504 CLIENT BANNED - hostile use');
			}
		} as any;
		await runWorkerOnce(
			{ db, session: null as any, rateLimiter: rl, log: pino({ level: 'silent' }), banAttempt: 0, lastBanAt: 0 },
			handlers
		);
		// 7-day pause (allow scheduling slack on the lower bound).
		const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
		expect(rl.pausedUntil).toBeGreaterThanOrEqual(t0 + SEVEN_DAYS_MS - 100);
		// Operator-visible meta key set.
		const perm = db.prepare(`SELECT value FROM meta WHERE key = 'udp_perm_banned'`).get() as
			| { value: string }
			| undefined;
		expect(perm?.value).toMatch(/504/);
		// Job marked non-retryable (status 'failed', not 'pending').
		const row = db.prepare(`SELECT status FROM job WHERE id = ?`).get(1) as { status: string };
		expect(row.status).toBe('failed');
	});

	it('does NOT tombstone the aid on a flood-class ban (555/timeout)', async () => {
		// Flood bans are CLIENT-side rate violations — they say nothing about
		// the aid that happened to be in flight. Tombstoning hides a random
		// aid for 14 days for no reason.
		const db = new Database(':memory:');
		runMigrations(db);
		seedTitle(db, 42);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 42 }, priority: 1 });
		const handlers = {
			anime_fetch: async () => {
				throw new Error('555 BANNED Flooding');
			}
		} as any;
		await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter: new RateLimiter({ intervalMs: 4000 }),
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			handlers
		);
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_42'`)
			.get();
		expect(tomb).toBeUndefined();
	});
});

describe('runWorkerOnce pre-flight gate', () => {
	it('passes anime_fetch through for an aid not in titles_dump (post JP filter rework)', async () => {
		// Pre-rework this case was "gated" (tombstoned non_japanese at gate
		// time). After the JP filter rework, the gate is title-blind — the
		// handler runs and the post-fetch classifier decides whether to
		// tombstone. We stub the handler to keep the test at the worker layer.
		const db = new Database(':memory:');
		runMigrations(db);
		enqueue(db, { kind: 'anime_fetch', params: { aid: 999 }, priority: 1 });
		let handlerCalled = false;
		const handlers = {
			anime_fetch: async () => {
				handlerCalled = true;
			}
		} as any;
		const result = await runWorkerOnce(
			{
				db,
				session: null as any,
				rateLimiter: {
					pausedUntil: 0,
					acquire: async () => {},
					penalty: () => {},
					hydrate: () => {}
				} as any,
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			},
			handlers
		);
		expect(result).toBe('processed');
		expect(handlerCalled).toBe(true);
		// Gate does NOT write tombstones anymore — handler is responsible.
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_999'`)
			.get();
		expect(tomb).toBeUndefined();
		expect(pendingCount(db)).toBe(0);
	});
});

function makeHydrateCtx(db: Database.Database) {
	return {
		db,
		session: null as never,
		rateLimiter: {
			pausedUntil: 0,
			acquire: async () => {},
			penalty: () => {},
			hydrate: () => {}
		} as never,
		log: pino({ level: 'silent' }),
		banAttempt: 0,
		lastBanAt: 0
	} as never;
}

describe('hydrateWorkerContext (JP-origin backfill)', () => {
	it('enqueues anime_fetch for cached aids + a sentinel on first boot', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		// Migration 008 ships origin_backfill_done='1' so hydrate skips the
		// next backfill by default (post-ban posture, 2026-05-16). Clear the
		// flag to exercise the original first-boot branch — the hydrate logic
		// itself is still required for any future backfill cycle.
		db.prepare(`DELETE FROM meta WHERE key = 'origin_backfill_done'`).run();
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (10, 1000)`).run();
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (11, 1000)`).run();
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (12, 1000)`).run();
		// Un-fetched aid — should NOT be enqueued.
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (13, NULL)`).run();

		hydrateWorkerContext(makeHydrateCtx(db));

		const jobs = db
			.prepare(`SELECT kind, params_json, priority FROM job ORDER BY priority, id`)
			.all() as { kind: string; params_json: string; priority: number }[];

		const fetchJobs = jobs.filter((j) => j.kind === 'anime_fetch');
		expect(fetchJobs.length).toBe(3);
		expect(fetchJobs.every((j) => j.priority === 100)).toBe(true);
		const parsed = fetchJobs.map(
			(j) => JSON.parse(j.params_json) as { aid: number; force?: boolean }
		);
		const aidsEnqueued = parsed.map((p) => p.aid).sort((a, b) => a - b);
		expect(aidsEnqueued).toEqual([10, 11, 12]);
		// Backfill jobs MUST carry force=true so they bypass the gate's TTL.
		expect(parsed.every((p) => p.force === true)).toBe(true);

		const marker = jobs.find((j) => j.kind === 'origin_backfill_complete');
		expect(marker).toBeDefined();
		expect(marker?.priority).toBe(101);

		expect(getMeta(db, 'origin_backfill_done')).toBe('enqueued');
	});

	it('does NOT re-enqueue when origin_backfill_done is already set to "enqueued"', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (10, 1000)`).run();
		setMeta(db, 'origin_backfill_done', 'enqueued');

		hydrateWorkerContext(makeHydrateCtx(db));

		const n = (db.prepare(`SELECT COUNT(*) AS n FROM job`).get() as { n: number }).n;
		expect(n).toBe(0);
	});

	it('does NOT re-enqueue when origin_backfill_done is already set to "1"', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (10, 1000)`).run();
		setMeta(db, 'origin_backfill_done', '1');

		hydrateWorkerContext(makeHydrateCtx(db));

		const n = (db.prepare(`SELECT COUNT(*) AS n FROM job`).get() as { n: number }).n;
		expect(n).toBe(0);
	});
});
