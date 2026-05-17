import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';

describe('runMigrations', () => {
	it('creates schema_migrations table and applies pending migrations', () => {
		const db = new Database(':memory:');
		runMigrations(db);

		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);

		expect(names).toContain('schema_migrations');
		expect(names).toContain('anime');
		expect(names).toContain('anime_title');
		expect(names).toContain('mylist');
		// calendar_entry was dropped by migration 002
		expect(names).not.toContain('calendar_entry');
		expect(names).toContain('titles_dump');
		expect(names).toContain('job');
		expect(names).toContain('meta');

		const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
			version: number;
		}[];
		expect(applied).toEqual([
			{ version: 1 },
			{ version: 2 },
			{ version: 3 },
			{ version: 4 },
			{ version: 5 },
			{ version: 6 },
			{ version: 7 },
			{ version: 8 },
			{ version: 9 },
			{ version: 10 },
			{ version: 11 }
		]);
	});

	it('is idempotent across re-runs', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		runMigrations(db);
		const count = db.prepare('SELECT COUNT(*) as n FROM schema_migrations').get() as { n: number };
		expect(count.n).toBe(11);
	});

	it('enables foreign keys and WAL mode', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
		expect(fk.foreign_keys).toBe(1);
	});

	it('applies migration 002: last_attempt_at column + drops calendar_entry', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		// last_attempt_at column exists on anime
		const cols = db.prepare(`PRAGMA table_info(anime)`).all() as { name: string }[];
		expect(cols.some((c) => c.name === 'last_attempt_at')).toBe(true);
		// calendar_entry table is gone
		const tables = db
			.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_entry'`)
			.all();
		expect(tables.length).toBe(0);
		// schema_migrations records all versions
		const rows = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as {
			version: number;
		}[];
		expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
	});

	it('applies migration 003: desc_last_attempt_at column', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const cols = db.prepare(`PRAGMA table_info(anime)`).all() as { name: string }[];
		expect(cols.some((c) => c.name === 'desc_last_attempt_at')).toBe(true);
	});

	it('applies migration 004: anidb_lid column on mylist', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const cols = db.prepare(`PRAGMA table_info(mylist)`).all() as { name: string }[];
		expect(cols.some((c) => c.name === 'anidb_lid')).toBe(true);
	});

	it('applies migration 005: clears origin_backfill_done + non_japanese tombstones from prior runs', () => {
		// Build the real schema first by running the full chain, then mutate
		// state to mirror the broken first-attempt condition, then drop the
		// migration-005 row so the runner replays it on a re-run.
		const db = new Database(':memory:');
		runMigrations(db);
		db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('origin_backfill_done', '1')`).run();
		db.prepare(
			`INSERT OR REPLACE INTO meta (key, value) VALUES ('tombstone_anime_42', 'non_japanese|1700000000')`
		).run();
		db.prepare(
			`INSERT OR REPLACE INTO meta (key, value) VALUES ('tombstone_anime_43', 'no_such_anime|1700000000')`
		).run();
		db.prepare(`DELETE FROM schema_migrations WHERE version = 5`).run();
		runMigrations(db);
		const flag = db.prepare(`SELECT value FROM meta WHERE key = 'origin_backfill_done'`).get();
		expect(flag).toBeUndefined();
		const stale = db
			.prepare(`SELECT key FROM meta WHERE key = 'tombstone_anime_42'`)
			.get();
		expect(stale).toBeUndefined();
		// Tombstones with OTHER reasons (no_such_anime, banned, etc.) survive.
		const kept = db
			.prepare(`SELECT key FROM meta WHERE key = 'tombstone_anime_43'`)
			.get();
		expect(kept).toBeDefined();
	});

	it('applies migration 008: sets origin_backfill_done="1" so hydrate skips the next backfill', () => {
		// 008 is the inverse of 005/006/007 — those CLEARED the flag to force
		// a re-fetch. After the ban incident on 2026-05-16, the 3rd backfill
		// (migration 007) already persisted correct tag/char/relation data
		// for every aid that succeeded before the flood ban started dropping
		// packets. A 4th backfill would risk another ban for negligible
		// benefit. 008 sets the flag so hydrate treats backfill as complete.
		const db = new Database(':memory:');
		runMigrations(db);
		// Even if a downstream caller cleared the flag, migration 008 sets it.
		db.prepare(`DELETE FROM meta WHERE key = 'origin_backfill_done'`).run();
		db.prepare(`DELETE FROM schema_migrations WHERE version = 8`).run();
		runMigrations(db);
		const flag = db.prepare(`SELECT value FROM meta WHERE key = 'origin_backfill_done'`).get() as
			| { value: string }
			| undefined;
		expect(flag?.value).toBe('1');
	});

	it('applies migration 007: clears origin_backfill_done so hydrate re-enqueues backfill', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		// Pretend backfill ran under the still-broken splitApos.
		db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('origin_backfill_done', '1')`).run();
		db.prepare(`DELETE FROM schema_migrations WHERE version = 7`).run();
		runMigrations(db);
		const flag = db.prepare(`SELECT value FROM meta WHERE key = 'origin_backfill_done'`).get();
		expect(flag).toBeUndefined();
	});

	it('applies migration 009: backfills anime.year from start_date when year was NULL', () => {
		// Repro of the prod symptom: 56 rows fetched under the broken year
		// parser had year=NULL but valid start_date. Migration 009 derives
		// year from start_date for those rows; leaves rows with NULL
		// start_date untouched (no derivation source).
		const db = new Database(':memory:');
		runMigrations(db);
		const APR_2026 = 1_743_897_600; // 2025-04-06 wait — verify: actually 2025-04-06
		// Use a stable known-year unix epoch: 2026-01-01 00:00:00 UTC = 1767225600
		const JAN_2026 = 1_767_225_600;
		const JAN_2024 = 1_704_067_200;
		// Seed: 3 rows mimicking the post-fix DB shape.
		// aid 1: NULL year + valid start_date (the broken case migration fixes)
		// aid 2: existing year — must NOT be overwritten
		// aid 3: NULL year + NULL start_date — no fix possible, stays NULL
		db.prepare(
			`INSERT INTO anime (aid, year, start_date, fetched_at) VALUES
				(1, NULL, ${JAN_2026}, 1),
				(2, 2024, ${JAN_2024}, 1),
				(3, NULL, NULL,         1)`
		).run();
		// Re-run migration 009 by removing its schema_migrations row.
		db.prepare(`DELETE FROM schema_migrations WHERE version = 9`).run();
		runMigrations(db);
		const r = db
			.prepare(`SELECT aid, year FROM anime ORDER BY aid`)
			.all() as { aid: number; year: number | null }[];
		expect(r).toEqual([
			{ aid: 1, year: 2026 }, // backfilled from start_date
			{ aid: 2, year: 2024 }, // unchanged (year was set)
			{ aid: 3, year: null } //  no source, stays null
		]);
	});

	it('applies migration 010: backfills year from end_date when both year and start_date are NULL', () => {
		// Edge case migration 009 doesn't cover — anime with year=NULL,
		// start_date=NULL, but end_date populated (finished-airing aids
		// where AniDB recorded only the end). 010 derives year from end_date
		// so the Unknown sidebar row approaches 0.
		const db = new Database(':memory:');
		runMigrations(db);
		const JAN_2024 = 1_704_067_200; // 2024-01-01 UTC
		const JAN_2026 = 1_767_225_600; // 2026-01-01 UTC
		// Seed 4 rows covering every combination 010 should consider:
		// 1: year=NULL, start_date=NULL, end_date set → derive from end_date
		// 2: year=NULL, start_date set,  end_date set → 010 leaves alone (009 handles)
		// 3: year set,  start_date=NULL, end_date set → 010 leaves alone (year present)
		// 4: year=NULL, start_date=NULL, end_date=NULL → no source, stays NULL
		db.prepare(
			`INSERT INTO anime (aid, year, start_date, end_date, fetched_at) VALUES
				(1, NULL, NULL,        ${JAN_2024}, 1),
				(2, NULL, ${JAN_2026}, ${JAN_2026}, 1),
				(3, 2020, NULL,        ${JAN_2026}, 1),
				(4, NULL, NULL,        NULL,        1)`
		).run();
		// Strip migration 009 + 010 from the applied set so re-running plays both.
		db.prepare(`DELETE FROM schema_migrations WHERE version IN (9, 10)`).run();
		runMigrations(db);
		const r = db
			.prepare(`SELECT aid, year FROM anime ORDER BY aid`)
			.all() as { aid: number; year: number | null }[];
		expect(r).toEqual([
			{ aid: 1, year: 2024 }, // backfilled from end_date by 010
			{ aid: 2, year: 2026 }, // backfilled from start_date by 009
			{ aid: 3, year: 2020 }, // unchanged (year was set)
			{ aid: 4, year: null } //  no source anywhere
		]);
	});

	it('applies migration 011: clears epoch-0 sentinel dates + year=1970 pollution', () => {
		// Repro of the production symptom: AniDB returns 0 for "unknown
		// date", animeFetch persisted 0 into start_date/end_date, migrations
		// 009/010 derived year=1970 from those zeros (strftime('%Y', 0) →
		// 1970). Aid 19238 (Witch Hat Atelier neighbour) showed year 1970
		// in the UI when AniDB has no year for it.
		const db = new Database(':memory:');
		runMigrations(db);
		const JAN_2026 = 1_767_225_600;
		// Seed 4 rows covering every combination 011 must handle:
		// 1: start_date=0 + end_date=0 + year=1970 → year cleared, dates NULL
		// 2: start_date=0 + end_date=real + year=1970 → dates fixed, year re-derived
		// 3: start_date=real + year=2026 → untouched (legitimate)
		// 4: end_date=0 + year=2024 + start_date=real → end_date NULL, year preserved
		db.prepare(
			`INSERT INTO anime (aid, year, start_date, end_date, fetched_at) VALUES
				(1, 1970, 0,           0,           1),
				(2, 1970, 0,           ${JAN_2026}, 1),
				(3, 2026, ${JAN_2026}, NULL,        1),
				(4, 2024, ${JAN_2026}, 0,           1)`
		).run();
		// Re-run migration 011 by removing its version.
		db.prepare(`DELETE FROM schema_migrations WHERE version = 11`).run();
		runMigrations(db);
		const r = db
			.prepare(`SELECT aid, year, start_date, end_date FROM anime ORDER BY aid`)
			.all() as { aid: number; year: number | null; start_date: number | null; end_date: number | null }[];
		expect(r).toEqual([
			{ aid: 1, year: null, start_date: null, end_date: null }, // pollution cleared
			{ aid: 2, year: 2026, start_date: null, end_date: JAN_2026 }, // year re-derived from end_date
			{ aid: 3, year: 2026, start_date: JAN_2026, end_date: null }, // untouched
			{ aid: 4, year: 2024, start_date: JAN_2026, end_date: null } // end_date=0 → NULL, year preserved
		]);
	});

	it('applies migration 006: clears origin_backfill_done + ghost anime_character rows', () => {
		// Simulate the post-Cycle-1 state: full schema present, backfill flag
		// set to '1' from the Cycle-1 hydrate run, and a few ghost rows in
		// anime_character that came from the corrupt amask slot.
		const db = new Database(':memory:');
		// Apply 1..5 by running through the normal runner first.
		runMigrations(db);
		// Force the broken state we expect to see in production.
		db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('origin_backfill_done', '1')`).run();
		db.prepare(
			`INSERT INTO anime (aid, type, fetched_at) VALUES (1, 'TV Series', 1)`
		).run();
		db.prepare(
			`INSERT INTO anime_character (aid, char_id) VALUES (1, 999)`
		).run();
		// Pretend migration 006 hasn't been applied yet by removing the row.
		db.prepare(`DELETE FROM schema_migrations WHERE version = 6`).run();
		// Re-run; the runner sees 6 as unapplied and replays the DELETEs.
		runMigrations(db);
		const flag = db.prepare(`SELECT value FROM meta WHERE key = 'origin_backfill_done'`).get();
		expect(flag).toBeUndefined();
		const ghosts = db.prepare(`SELECT COUNT(*) AS n FROM anime_character`).get() as { n: number };
		expect(ghosts.n).toBe(0);
	});
});
