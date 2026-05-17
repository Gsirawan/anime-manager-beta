import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { setMeta } from '../../src/lib/server/db/repositories/meta';
import { preFlightGate } from '../../src/lib/server/jobs/preFlightGate';

const TTL_14D_SEC = 14 * 86400;

function seedTitle(db: any, aid: number) {
	db.prepare(`INSERT INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)`).run(
		aid,
		'x-jat',
		'main',
		'Test Title'
	);
}

describe('preFlightGate (anime_fetch)', () => {
	let db: any;
	const nowSec = 1_700_000_000;
	const nowMs = nowSec * 1000;

	beforeEach(() => {
		db = new Database(':memory:');
		runMigrations(db);
	});

	it('rejects when rate limiter is paused', () => {
		seedTitle(db, 1);
		const r = preFlightGate(
			db,
			{ kind: 'anime_fetch', aid: 1 },
			nowMs,
			{ pausedUntil: nowMs + 60_000 }
		);
		expect(r.send).toBe(false);
		expect(r.reason).toBe('paused');
	});

	it('rejects when aid is tombstoned (no_such_anime, never unlocks)', () => {
		seedTitle(db, 1);
		setMeta(db, 'tombstone_anime_1', `no_such_anime|${nowSec - 1}`);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('tombstoned');
	});

	it('unlocks a banned tombstone after 14 days', () => {
		seedTitle(db, 1);
		setMeta(db, 'tombstone_anime_1', `banned|${nowSec - TTL_14D_SEC - 10}`);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	it('keeps a banned tombstone active before 14 days', () => {
		seedTitle(db, 1);
		setMeta(db, 'tombstone_anime_1', `banned|${nowSec - 1000}`);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('tombstoned');
	});

	it('rejects when last_attempt_at is younger than 14d', () => {
		seedTitle(db, 1);
		db.prepare(`INSERT INTO anime (aid, last_attempt_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('recently_attempted');
	});

	it('rejects when fetched_at is younger than 14d', () => {
		seedTitle(db, 1);
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (?, ?)`).run(1, nowSec - 100);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('recently_fetched');
	});

	it('passes anime_fetch through even when the aid is NOT in titles_dump (JP gate removed)', () => {
		// JP-origin filtering moved to the post-fetch classifier in animeFetch.
		// The gate no longer cares about titles_dump membership.
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 999 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	it('does NOT write a non_japanese tombstone at gate time (moved to handler)', () => {
		preFlightGate(db, { kind: 'anime_fetch', aid: 999 }, nowMs, { pausedUntil: 0 });
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_999'`)
			.get() as { value: string } | undefined;
		expect(tomb).toBeUndefined();
	});

	it('passes when all checks pass', () => {
		seedTitle(db, 1);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	// force=true semantics (JP-origin backfill v2)

	it('force=true bypasses the 14-day fetched_at TTL', () => {
		seedTitle(db, 1);
		db.prepare(`INSERT INTO anime (aid, fetched_at) VALUES (?, ?)`).run(1, nowSec - 100);
		const r = preFlightGate(
			db,
			{ kind: 'anime_fetch', aid: 1, force: true },
			nowMs,
			{ pausedUntil: 0 }
		);
		expect(r.send).toBe(true);
	});

	it('force=true bypasses the 14-day last_attempt_at TTL', () => {
		seedTitle(db, 1);
		db.prepare(`INSERT INTO anime (aid, last_attempt_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(
			db,
			{ kind: 'anime_fetch', aid: 1, force: true },
			nowMs,
			{ pausedUntil: 0 }
		);
		expect(r.send).toBe(true);
	});

	it('force=true does NOT bypass the pause gate', () => {
		seedTitle(db, 1);
		const r = preFlightGate(
			db,
			{ kind: 'anime_fetch', aid: 1, force: true },
			nowMs,
			{ pausedUntil: nowMs + 60_000 }
		);
		expect(r.send).toBe(false);
		expect(r.reason).toBe('paused');
	});

	it('force=true does NOT bypass the tombstone gate', () => {
		seedTitle(db, 1);
		setMeta(db, 'tombstone_anime_1', `non_japanese|${nowSec - 1}`);
		const r = preFlightGate(
			db,
			{ kind: 'anime_fetch', aid: 1, force: true },
			nowMs,
			{ pausedUntil: 0 }
		);
		expect(r.send).toBe(false);
		expect(r.reason).toBe('tombstoned');
	});

	it('force=true bypasses TTL on anime_desc_fetch independently', () => {
		seedTitle(db, 1);
		db.prepare(`INSERT INTO anime (aid, desc_fetched_at) VALUES (?, ?)`).run(1, nowSec - 100);
		const r = preFlightGate(
			db,
			{ kind: 'anime_desc_fetch', aid: 1, force: true },
			nowMs,
			{ pausedUntil: 0 }
		);
		expect(r.send).toBe(true);
	});
});

describe('preFlightGate per-kind TTL (regression: ANIMEDESC blocked by ANIME stamp)', () => {
	let db: any;
	const nowSec = 1_700_000_000;
	const nowMs = nowSec * 1000;

	beforeEach(() => {
		db = new Database(':memory:');
		runMigrations(db);
		db.prepare(`INSERT INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)`).run(
			1,
			'x-jat',
			'main',
			'Re:Zero'
		);
	});

	it('anime_desc_fetch is NOT blocked by anime.last_attempt_at (it has its own column)', () => {
		// animeFetch just stamped this 10 seconds ago
		db.prepare(`INSERT INTO anime (aid, last_attempt_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(db, { kind: 'anime_desc_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	it('anime_desc_fetch IS blocked when desc_last_attempt_at is fresh', () => {
		db.prepare(`INSERT INTO anime (aid, desc_last_attempt_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(db, { kind: 'anime_desc_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('recently_attempted');
	});

	it('anime_desc_fetch IS blocked when desc_fetched_at is fresh', () => {
		db.prepare(`INSERT INTO anime (aid, desc_fetched_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(db, { kind: 'anime_desc_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(false);
		expect(r.reason).toBe('recently_fetched');
	});

	it('anime_fetch is NOT affected by desc_last_attempt_at', () => {
		db.prepare(`INSERT INTO anime (aid, desc_last_attempt_at) VALUES (?, ?)`).run(1, nowSec - 10);
		const r = preFlightGate(db, { kind: 'anime_fetch', aid: 1 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});
});

describe('preFlightGate (other job kinds)', () => {
	let db: any;
	const nowMs = 1_700_000_000_000;
	beforeEach(() => {
		db = new Database(':memory:');
		runMigrations(db);
	});

	it('mylist_add bypasses JP filter and TTL', () => {
		// No titles_dump row at all
		const r = preFlightGate(db, { kind: 'mylist_add', aid: 42 }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	it('still rejects mylist when paused', () => {
		const r = preFlightGate(db, { kind: 'mylist_add', aid: 42 }, nowMs, {
			pausedUntil: nowMs + 1000
		});
		expect(r.send).toBe(false);
		expect(r.reason).toBe('paused');
	});

	it('titles_dump_refresh always passes when not paused', () => {
		const r = preFlightGate(db, { kind: 'titles_dump_refresh' }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});

	it('updated_sync passes when not paused', () => {
		const r = preFlightGate(db, { kind: 'updated_sync' }, nowMs, { pausedUntil: 0 });
		expect(r.send).toBe(true);
	});
});
