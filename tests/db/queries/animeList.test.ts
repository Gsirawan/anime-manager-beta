import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { listAnime, sortToOrderParams } from '../../../src/lib/server/db/queries/animeList';
import { setMeta } from '../../../src/lib/server/db/repositories/meta';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';

function freshDb(): BetterSqlite3.Database {
	const db = new Database(':memory:');
	runMigrations(db);
	return db;
}

describe('listAnime — tombstone filtering', () => {
	let db: BetterSqlite3.Database;
	beforeEach(() => {
		db = freshDb();
		db.prepare(`INSERT INTO anime (aid, type) VALUES (1, 'TV Series')`).run();
		db.prepare(`INSERT INTO anime (aid, type) VALUES (2, 'TV Series')`).run();
		db.prepare(`INSERT INTO anime (aid, type) VALUES (3, 'TV Series')`).run();
	});

	it('excludes tombstoned aids from world-tab results', () => {
		setMeta(db, 'tombstone_anime_2', `non_japanese|${Date.now()}`);
		const r = listAnime(db, { tab: 'world' });
		const aids = r.items.map((x) => x.aid).sort((a, b) => a - b);
		expect(aids).toEqual([1, 3]);
	});

	it('projects tombstoned:false on non-tombstoned world-tab cards', () => {
		const r = listAnime(db, { tab: 'world' });
		expect(r.items.every((c) => c.tombstoned === false)).toBe(true);
	});

	it('keeps tombstoned aids visible in my-tab with tombstoned:true flag', () => {
		db.prepare(
			`INSERT INTO mylist (aid, status, anidb_synced_at) VALUES (1, 'watching', NULL),
			                                                         (2, 'plan', NULL)`
		).run();
		setMeta(db, 'tombstone_anime_2', `non_japanese|${Date.now()}`);
		const r = listAnime(db, { tab: 'my' });
		const aids = r.items.map((x) => x.aid).sort((a, b) => a - b);
		expect(aids).toEqual([1, 2]);
		const card2 = r.items.find((x) => x.aid === 2);
		expect(card2?.tombstoned).toBe(true);
		const card1 = r.items.find((x) => x.aid === 1);
		expect(card1?.tombstoned).toBe(false);
	});
});

// ─── sortToOrderParams — page1/pageN continuity helper ─────────────────────
describe('sortToOrderParams', () => {
	const NOW = 1_800_000_000; // fixed for assertions; real callers pass Date.now()
	it('maps "rating" → rating DESC, no date cutoff (Top sort)', () => {
		expect(sortToOrderParams('rating', NOW)).toEqual({ orderBy: 'rating', direction: 'desc' });
	});
	it('maps "upcoming" → start_date ASC + startDateAfter=now (future only)', () => {
		expect(sortToOrderParams('upcoming', NOW)).toEqual({
			orderBy: 'start_date',
			direction: 'asc',
			startDateAfter: NOW
		});
	});
	it('maps "latest" → start_date DESC + startDateBefore=now (aired only)', () => {
		// Cutoff drops future-dated anime from Latest. Without it, 2027
		// announcements would sit at the top for months.
		expect(sortToOrderParams('latest', NOW)).toEqual({
			orderBy: 'start_date',
			direction: 'desc',
			startDateBefore: NOW
		});
	});
	it('maps "all" → start_date DESC, no cutoff (everything by date)', () => {
		expect(sortToOrderParams('all', NOW)).toEqual({ orderBy: 'start_date', direction: 'desc' });
	});
	it('returns empty object on null/undefined/empty (callers keep defaults)', () => {
		expect(sortToOrderParams(null)).toEqual({});
		expect(sortToOrderParams(undefined)).toEqual({});
		expect(sortToOrderParams('')).toEqual({});
	});
	it('treats unrecognized sort as "all" (no cutoff)', () => {
		expect(sortToOrderParams('garbage', NOW)).toEqual({
			orderBy: 'start_date',
			direction: 'desc'
		});
	});
});

// ─── New filters: yearNull + startDateBefore + startDateAfter ──────────────
describe('listAnime — new filters', () => {
	let db: BetterSqlite3.Database;
	beforeEach(() => {
		db = freshDb();
		// Mix of past, current, future, and unknown dates / years.
		const PAST = 1700000000; // 2023
		const CURRENT = 1750000000; // 2024
		const FUTURE = 1900000000; // 2030-ish
		db.prepare(
			`INSERT INTO anime (aid, type, start_date, year) VALUES
				(10, 'TV Series', ${PAST},    2023),
				(11, 'TV Series', ${CURRENT}, 2024),
				(12, 'TV Series', ${FUTURE},  2030),
				(13, 'TV Series', NULL,       NULL),
				(14, 'Movie',     NULL,       2022)`
		).run();
	});

	it('yearNull filters to anime with year IS NULL', () => {
		const r = listAnime(db, { tab: 'world', yearNull: true });
		expect(r.items.map((x) => x.aid)).toEqual([13]);
	});

	it('year takes precedence over yearNull when both set', () => {
		const r = listAnime(db, { tab: 'world', year: 2023, yearNull: true });
		expect(r.items.map((x) => x.aid)).toEqual([10]);
	});

	it('startDateBefore (Latest cutoff) drops future-dated anime', () => {
		// CURRENT is the boundary; rows with start_date <= CURRENT survive.
		// NULL start_date rows are excluded (NULL <= anything is NULL).
		const r = listAnime(db, { tab: 'world', startDateBefore: 1750000000 });
		expect(r.items.map((x) => x.aid).sort()).toEqual([10, 11]);
	});

	it('startDateAfter (Upcoming cutoff) drops past-aired anime', () => {
		// Only rows with start_date > CURRENT. NULL rows excluded.
		const r = listAnime(db, { tab: 'world', startDateAfter: 1750000000 });
		expect(r.items.map((x) => x.aid)).toEqual([12]);
	});

	it('Latest cutoff + start_date DESC = correct order', () => {
		const r = listAnime(db, {
			tab: 'world',
			startDateBefore: 1750000000,
			orderBy: 'start_date',
			direction: 'desc'
		});
		// Newest first: 11 (CURRENT) → 10 (PAST). 12 (FUTURE) dropped, 13/14 NULL dropped.
		expect(r.items.map((x) => x.aid)).toEqual([11, 10]);
	});

	it('Upcoming cutoff + start_date ASC = soonest first', () => {
		const r = listAnime(db, {
			tab: 'world',
			startDateAfter: 1750000000,
			orderBy: 'start_date',
			direction: 'asc'
		});
		expect(r.items.map((x) => x.aid)).toEqual([12]);
	});
});

// ─── Composite-cursor pagination ────────────────────────────────────────────
//
// Regression for the v0.1 pagination bug. Pre-fix:
//   - API ignored ?sort=, defaulted to aid/asc → page 2 disagreed with page 1.
//   - Cursor was always `aid > ?` even when ORDER BY was start_date DESC,
//     so 12 of 95 visible anime were unreachable.
// Post-fix:
//   - sortToOrderParams resolves the same orderBy/direction on both sides.
//   - Cursor format `phase|value|aid` with phase ∈ {a, b, c} crosses the
//     NULL-bucket boundary cleanly.
describe('listAnime — composite cursor pagination', () => {
	let db: BetterSqlite3.Database;
	beforeEach(() => {
		db = freshDb();
		// 7 anime with mixed start_date / rating, including NULL rows for the
		// NULL-boundary tests. Seeded out of aid order so a buggy aid-only
		// cursor on a non-aid sort produces wrong results.
		db.prepare(
			`INSERT INTO anime (aid, type, start_date, rating, year) VALUES
				(100, 'TV Series', 1700000000, 8.5, 2023),
				(200, 'TV Series', 1750000000, 7.0, 2024),
				(300, 'TV Series', 1600000000, 9.0, 2020),
				(400, 'TV Series', 1800000000, 6.5, 2025),
				(500, 'TV Series', 1650000000, 8.0, 2022),
				(600, 'TV Series', NULL,       NULL, NULL),
				(700, 'TV Series', NULL,       NULL, NULL)`
		).run();
	});

	it('aid sort: cursor walks aids in order, no anime missed', () => {
		const p1 = listAnime(db, { tab: 'world', orderBy: 'aid', direction: 'asc', limit: 3 });
		expect(p1.items.map((x) => x.aid)).toEqual([100, 200, 300]);
		expect(p1.nextCursor).toBe('c||300');

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'aid',
			direction: 'asc',
			limit: 3,
			cursor: p1.nextCursor
		});
		expect(p2.items.map((x) => x.aid)).toEqual([400, 500, 600]);

		const p3 = listAnime(db, {
			tab: 'world',
			orderBy: 'aid',
			direction: 'asc',
			limit: 3,
			cursor: p2.nextCursor
		});
		expect(p3.items.map((x) => x.aid)).toEqual([700]);
		expect(p3.nextCursor).toBeUndefined();
	});

	it('start_date DESC: cursor preserves sort order across pages', () => {
		// Expected sort: 400(1.8e9), 200(1.75e9), 100(1.7e9), 500(1.65e9), 300(1.6e9), NULLS LAST: 600, 700
		// Phase-a queries exclude NULL rows by construction — they only appear
		// via a phase-b cursor (emitted when phase-a underfills or completes
		// at-limit on a NULL last row).
		const p1 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 3
		});
		expect(p1.items.map((x) => x.aid)).toEqual([400, 200, 100]);
		expect(p1.nextCursor).toMatch(/^a\|1700000000\|100$/);

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 3,
			cursor: p1.nextCursor
		});
		// Remaining non-NULL rows: 500, 300. Underfills (2 < 3) → boundary cursor.
		expect(p2.items.map((x) => x.aid)).toEqual([500, 300]);
		expect(p2.nextCursor).toBe('b||0');

		const p3 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 3,
			cursor: p2.nextCursor
		});
		// NULL bucket — both 600 and 700.
		expect(p3.items.map((x) => x.aid)).toEqual([600, 700]);
		expect(p3.nextCursor).toBeUndefined();
	});

	it('start_date DESC: emits phase-b cursor when phase-a underfills', () => {
		// limit=4 means page 1 captures all 5 non-NULL rows + first NULL row.
		// Wait — page 1 with limit=4 fills with 400/200/100/500, leaves 300 + 2 NULLs.
		const p1 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 4
		});
		expect(p1.items.map((x) => x.aid)).toEqual([400, 200, 100, 500]);
		// Page filled with phase-a row → phase-a cursor.
		expect(p1.nextCursor).toMatch(/^a\|/);

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 4,
			cursor: p1.nextCursor
		});
		// 1 remaining non-NULL row (300), then 2 NULLs would follow but the
		// phase-a query only returns non-NULL rows. Page returns just [300]
		// (size 1 < limit 4) → boundary cursor 'b||0' to start NULL bucket.
		expect(p2.items.map((x) => x.aid)).toEqual([300]);
		expect(p2.nextCursor).toBe('b||0');

		const p3 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 4,
			cursor: p2.nextCursor
		});
		// NULL bucket — 600 and 700, ordered by aid asc.
		expect(p3.items.map((x) => x.aid)).toEqual([600, 700]);
		expect(p3.nextCursor).toBeUndefined();
	});

	it('rating DESC (Top sort): keyset crosses NULL boundary', () => {
		// Expected: 300(9.0), 100(8.5), 500(8.0), 200(7.0), 400(6.5), NULLS LAST: 600, 700
		const p1 = listAnime(db, {
			tab: 'world',
			orderBy: 'rating',
			direction: 'desc',
			limit: 5
		});
		expect(p1.items.map((x) => x.aid)).toEqual([300, 100, 500, 200, 400]);
		// Filled with last row's rating = 6.5
		expect(p1.nextCursor).toMatch(/^a\|6\.5\|400$/);

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'rating',
			direction: 'desc',
			limit: 5,
			cursor: p1.nextCursor
		});
		// Phase-a query returns 0 (no rows with rating < 6.5) → boundary cursor.
		expect(p2.items).toEqual([]);
		expect(p2.nextCursor).toBe('b||0');

		const p3 = listAnime(db, {
			tab: 'world',
			orderBy: 'rating',
			direction: 'desc',
			limit: 5,
			cursor: p2.nextCursor
		});
		expect(p3.items.map((x) => x.aid)).toEqual([600, 700]);
		expect(p3.nextCursor).toBeUndefined();
	});

	it('start_date ASC (Upcoming sort): cursor uses > operator', () => {
		// Expected: 300(1.6e9), 500(1.65e9), 100(1.7e9), 200(1.75e9), 400(1.8e9), NULL: 600, 700
		const p1 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'asc',
			limit: 2
		});
		expect(p1.items.map((x) => x.aid)).toEqual([300, 500]);
		expect(p1.nextCursor).toMatch(/^a\|1650000000\|500$/);

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'asc',
			limit: 2,
			cursor: p1.nextCursor
		});
		expect(p2.items.map((x) => x.aid)).toEqual([100, 200]);
	});

	it('legacy bare-aid cursor still works on aid sort', () => {
		const p = listAnime(db, {
			tab: 'world',
			orderBy: 'aid',
			direction: 'asc',
			limit: 10,
			cursor: '300'
		});
		expect(p.items.map((x) => x.aid)).toEqual([400, 500, 600, 700]);
	});

	it('tombstones excluded across pagination boundary', () => {
		setMeta(db, 'tombstone_anime_300', `non_japanese|${Date.now()}`);
		const p1 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 3
		});
		// Tombstoned 300 (rating 9.0, start_date 1.6e9) dropped from non-NULL
		// bucket — page 1 was [400, 200, 100] without tombstone, still
		// [400, 200, 100] with it (300 was below 500 anyway). Page 2 would
		// have been [500, 300, 600] but 300 is dropped → [500, 600, 700].
		// 600 is NULL-bucket so the page is mixed-phase. Page 2 will return
		// [500] then cross into NULL bucket on the next page.
		expect(p1.items.map((x) => x.aid)).toEqual([400, 200, 100]);

		const p2 = listAnime(db, {
			tab: 'world',
			orderBy: 'start_date',
			direction: 'desc',
			limit: 3,
			cursor: p1.nextCursor
		});
		// 500 is the only remaining non-NULL row (300 tombstoned), then phase-a
		// underfills → boundary cursor.
		expect(p2.items.map((x) => x.aid)).toEqual([500]);
		expect(p2.nextCursor).toBe('b||0');
	});

	it('no cursor emitted when single page fits all rows', () => {
		const p = listAnime(db, { tab: 'world', orderBy: 'aid', direction: 'asc', limit: 100 });
		expect(p.items.length).toBe(7);
		expect(p.nextCursor).toBeUndefined();
	});
});
