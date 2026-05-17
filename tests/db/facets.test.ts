import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { upsert as upsertMylist } from '../../src/lib/server/db/repositories/mylist';
import { setMeta } from '../../src/lib/server/db/repositories/meta';
import {
	getStatusCounts,
	getYearCounts,
	getYearUnknownCount,
	getTypeCounts,
	getRatingBucketCounts
} from '../../src/lib/server/db/queries/facets';

function seed() {
	const db = new Database(':memory:');
	runMigrations(db);
	const now = Math.floor(Date.now() / 1000);
	upsertAnime(db, { aid: 1, year: 2026, type: 'TV Series', rating: 8.4, fetched_at: now });
	upsertAnime(db, { aid: 2, year: 2026, type: 'Movie', rating: 7.2, fetched_at: now });
	upsertAnime(db, { aid: 3, year: 2025, type: 'TV Series', rating: 9.1, fetched_at: now });
	upsertAnime(db, { aid: 4, year: 2018, type: 'OVA', rating: 6.4, fetched_at: now });
	upsertAnime(db, { aid: 5, year: 1999, type: 'TV Series', rating: null, fetched_at: now });
	return db;
}

describe('facet counts', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = seed();
	});

	it('getStatusCounts returns counts per mylist status', () => {
		upsertMylist(db, { aid: 1, status: 'watching' });
		upsertMylist(db, { aid: 2, status: 'plan' });
		upsertMylist(db, { aid: 3, status: 'completed' });
		upsertMylist(db, { aid: 4, status: 'plan' });
		const r = getStatusCounts(db);
		expect(r).toEqual({ plan: 2, watching: 1, completed: 1, on_hold: 0, dropped: 0 });
	});

	it('getYearCounts(scope=world-anime) counts anime by year, desc', () => {
		const r = getYearCounts(db, 'world-anime');
		expect(r).toEqual([
			{ year: 2026, count: 2 },
			{ year: 2025, count: 1 },
			{ year: 2018, count: 1 },
			{ year: 1999, count: 1 }
		]);
	});

	it('getYearCounts(scope=my-anime) only counts anime in mylist', () => {
		upsertMylist(db, { aid: 1, status: 'watching' });
		upsertMylist(db, { aid: 3, status: 'plan' });
		const r = getYearCounts(db, 'my-anime');
		expect(r).toEqual([
			{ year: 2026, count: 1 },
			{ year: 2025, count: 1 }
		]);
	});

	it('getTypeCounts(scope=world-anime) counts by type', () => {
		const r = getTypeCounts(db, 'world-anime');
		// TV Series appears 3 times, Movie 1, OVA 1
		const tvEntry = r.find((x) => x.type === 'TV Series');
		const movieEntry = r.find((x) => x.type === 'Movie');
		expect(tvEntry).toEqual({ type: 'TV Series', count: 3 });
		expect(movieEntry).toEqual({ type: 'Movie', count: 1 });
	});

	it('getRatingBucketCounts(scope=world-anime) returns ordered buckets', () => {
		const r = getRatingBucketCounts(db, 'world-anime');
		// aid 3: 9.1 (8+), aid 1: 8.4 (8+), aid 2: 7.2 (7+), aid 4: 6.4 (6+), aid 5: null (unrated)
		expect(r['8+']).toBe(2);
		expect(r['7+']).toBe(1);
		expect(r['6+']).toBe(1);
		expect(r['any']).toBe(5);
	});
});

// ─── Tombstone exclusion regression — v0.1 fix ─────────────────────────────
//
// Before this fix the three world-scope facet queries hit `anime` directly
// with no tombstone filter. Result: chip totals included non-Japanese (and
// no_such_anime, banned) aids that the card grid had already hidden, so
// "TV Series (68)" did not match the visible 66 rows. Per-aid reproduction
// case from prod (2026-05-17): 96 anime, 5 tombstones, visible 91.
describe('facet counts — tombstone exclusion (world scope)', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = new Database(':memory:');
		runMigrations(db);
		const now = Math.floor(Date.now() / 1000);
		// 4 fetched anime, 3 distinct years, 3 distinct types, mixed ratings.
		upsertAnime(db, { aid: 10, year: 2026, type: 'TV Series', rating: 8.5, fetched_at: now });
		upsertAnime(db, { aid: 11, year: 2026, type: 'Movie', rating: 7.0, fetched_at: now });
		upsertAnime(db, { aid: 12, year: 2025, type: 'TV Series', rating: 6.5, fetched_at: now });
		upsertAnime(db, { aid: 13, year: 2024, type: 'OVA', rating: null, fetched_at: now });
		// Tombstone aid 11 (Movie/2026/7.0). World facets must drop it.
		setMeta(db, 'tombstone_anime_11', `non_japanese|${now}`);
	});

	it('getTypeCounts excludes tombstoned aids on world scope', () => {
		const r = getTypeCounts(db, 'world-anime');
		const types = Object.fromEntries(r.map((x) => [x.type, x.count]));
		expect(types['TV Series']).toBe(2); // aids 10, 12
		expect(types['Movie']).toBeUndefined(); // aid 11 tombstoned, no rows survive
		expect(types['OVA']).toBe(1); // aid 13
	});

	it('getYearCounts excludes tombstoned aids on world scope', () => {
		const r = getYearCounts(db, 'world-anime');
		const years = Object.fromEntries(r.map((x) => [x.year, x.count]));
		expect(years[2026]).toBe(1); // only aid 10 (aid 11 dropped)
		expect(years[2025]).toBe(1); // aid 12
		expect(years[2024]).toBe(1); // aid 13
	});

	it('getRatingBucketCounts excludes tombstoned aids on world scope', () => {
		const r = getRatingBucketCounts(db, 'world-anime');
		// Visible: aid 10 (8.5 → 8+), aid 12 (6.5 → 6+), aid 13 (null → only any).
		// Tombstoned: aid 11 (7.0 → 7+) — must not appear in any bucket.
		expect(r.any).toBe(3);
		expect(r['8+']).toBe(1);
		expect(r['7+']).toBe(0);
		expect(r['6+']).toBe(1);
	});

	it('my-anime scope is NOT affected by tombstones (intentional)', () => {
		// Symmetric setup: tombstoned aid in mylist must still count.
		// "Out of scope" badge is the UI signal; query layer keeps the row.
		upsertMylist(db, { aid: 10, status: 'watching' });
		upsertMylist(db, { aid: 11, status: 'plan' }); // tombstoned but in mylist
		upsertMylist(db, { aid: 12, status: 'completed' });
		const types = getTypeCounts(db, 'my-anime');
		const t = Object.fromEntries(types.map((x) => [x.type, x.count]));
		expect(t['TV Series']).toBe(2);
		expect(t['Movie']).toBe(1); // aid 11 — tombstoned, still counted for my-anime
	});
});

// ─── getYearUnknownCount — surfaces the NULL-year hole ─────────────────────
//
// Anime fetched before the year-as-string fix (commit 6dce77c) wrote NULL
// to anime.year. The year sidebar's `year IS NOT NULL` filter dropped them
// silently, making the year sum mismatch the type sum (39 vs 96 in prod).
// This helper surfaces that count as an informational "Unknown" row.
describe('getYearUnknownCount', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = new Database(':memory:');
		runMigrations(db);
		const now = Math.floor(Date.now() / 1000);
		upsertAnime(db, { aid: 20, year: 2026, type: 'TV Series', fetched_at: now });
		upsertAnime(db, { aid: 21, year: null, type: 'TV Series', fetched_at: now });
		upsertAnime(db, { aid: 22, year: null, type: 'OVA', fetched_at: now });
		upsertAnime(db, { aid: 23, year: null, type: 'Movie', fetched_at: now });
		// Tombstone one of the NULL-year aids; world scope must exclude it.
		setMeta(db, 'tombstone_anime_23', `non_japanese|${now}`);
	});

	it('counts non-tombstoned NULL-year anime on world scope', () => {
		// aids 21, 22 (aid 23 tombstoned, aid 20 has a year)
		expect(getYearUnknownCount(db, 'world-anime')).toBe(2);
	});

	it('counts only mylist NULL-year anime on my scope (tombstones not excluded)', () => {
		upsertMylist(db, { aid: 21, status: 'watching' });
		upsertMylist(db, { aid: 23, status: 'plan' }); // tombstoned but in mylist
		// aid 22 is NULL-year but not in mylist → excluded.
		// aid 23 is NULL-year + tombstoned + in mylist → INCLUDED (my-anime
		// keeps tombstones visible).
		expect(getYearUnknownCount(db, 'my-anime')).toBe(2);
	});

	it('returns 0 when no NULL-year rows exist', () => {
		const db2 = new Database(':memory:');
		runMigrations(db2);
		const now = Math.floor(Date.now() / 1000);
		upsertAnime(db2, { aid: 1, year: 2026, type: 'TV Series', fetched_at: now });
		expect(getYearUnknownCount(db2, 'world-anime')).toBe(0);
	});
});
