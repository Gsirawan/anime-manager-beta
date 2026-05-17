import type BetterSqlite3 from 'better-sqlite3';

export function getTypes(db: BetterSqlite3.Database): string[] {
	return (
		db.prepare('SELECT DISTINCT type FROM anime WHERE type IS NOT NULL ORDER BY type').all() as {
			type: string;
		}[]
	).map((r) => r.type);
}

export function getYears(db: BetterSqlite3.Database): number[] {
	return (
		db
			.prepare('SELECT DISTINCT year FROM anime WHERE year IS NOT NULL ORDER BY year DESC LIMIT 30')
			.all() as { year: number }[]
	).map((r) => r.year);
}

export function getTopGenres(db: BetterSqlite3.Database, limit = 20): string[] {
	return (
		db
			.prepare(
				'SELECT tag_name, COUNT(*) AS n FROM anime_tag GROUP BY tag_name ORDER BY n DESC LIMIT ?'
			)
			.all(limit) as { tag_name: string }[]
	).map((r) => r.tag_name);
}

// ─── v2: count queries for sidebar + FilterBar ───────────────────────────────
//
// Tombstone semantics — must match animeList.ts:
//   world-anime: tombstoned aids are EXCLUDED from grid + counts.
//   my-anime:    tombstoned aids stay visible (carry a `tombstoned` flag);
//                a non-Japanese show the user added to mylist is still theirs
//                to see, just marked Out of scope. Same rule for counts.
//
// The world-scope exclusion fragment lives in one place so the three count
// functions can't drift from each other or from animeList.ts. Anyone adding
// a new world-scope facet MUST AND this clause into the WHERE.
const WORLD_TOMBSTONE_EXCLUSION =
	`NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tombstone_anime_' || a.aid)`;

export interface StatusCounts {
	plan: number;
	watching: number;
	completed: number;
	on_hold: number;
	dropped: number;
}

export function getStatusCounts(db: BetterSqlite3.Database): StatusCounts {
	const rows = db
		.prepare(
			`SELECT status, COUNT(*) AS n FROM mylist
       WHERE status IN ('plan','watching','completed','on_hold','dropped')
       GROUP BY status`
		)
		.all() as { status: string; n: number }[];
	const base: StatusCounts = { plan: 0, watching: 0, completed: 0, on_hold: 0, dropped: 0 };
	for (const r of rows) {
		(base as unknown as Record<string, number>)[r.status] = r.n;
	}
	return base;
}

export interface YearCount {
	year: number;
	count: number;
}

export function getYearCounts(
	db: BetterSqlite3.Database,
	scope: 'my-anime' | 'world-anime'
): YearCount[] {
	if (scope === 'my-anime') {
		return db
			.prepare(
				`SELECT a.year, COUNT(*) AS count
         FROM anime a
         JOIN mylist m ON m.aid = a.aid
         WHERE a.year IS NOT NULL
         GROUP BY a.year
         ORDER BY a.year DESC`
			)
			.all() as YearCount[];
	}
	return db
		.prepare(
			`SELECT a.year, COUNT(*) AS count
       FROM anime a
       WHERE a.year IS NOT NULL
         AND ${WORLD_TOMBSTONE_EXCLUSION}
       GROUP BY a.year
       ORDER BY a.year DESC`
		)
		.all() as YearCount[];
}

/**
 * Count of non-tombstoned anime where year is NULL (world scope) or where
 * the user has them in mylist with a NULL year (my scope).
 *
 * Renders as a non-clickable "Unknown (N)" row in the year sidebar so the
 * year sum lines up with the type/rating sums. Older anime fetched before
 * the year-string fix (commit 6dce77c) wrote NULL to anime.year; those rows
 * self-heal on their next fetch (14-day TTL) but until then the sidebar
 * needs to acknowledge them or the math looks broken.
 */
export function getYearUnknownCount(
	db: BetterSqlite3.Database,
	scope: 'my-anime' | 'world-anime'
): number {
	if (scope === 'my-anime') {
		const row = db
			.prepare(
				`SELECT COUNT(*) AS n FROM anime a
         JOIN mylist m ON m.aid = a.aid
         WHERE a.year IS NULL`
			)
			.get() as { n: number };
		return row.n;
	}
	const row = db
		.prepare(
			`SELECT COUNT(*) AS n FROM anime a
       WHERE a.year IS NULL
         AND ${WORLD_TOMBSTONE_EXCLUSION}`
		)
		.get() as { n: number };
	return row.n;
}

export interface TypeCount {
	type: string;
	count: number;
}

export function getTypeCounts(
	db: BetterSqlite3.Database,
	scope: 'my-anime' | 'world-anime'
): TypeCount[] {
	if (scope === 'my-anime') {
		return db
			.prepare(
				`SELECT a.type, COUNT(*) AS count
         FROM anime a
         JOIN mylist m ON m.aid = a.aid
         WHERE a.type IS NOT NULL
         GROUP BY a.type
         ORDER BY count DESC`
			)
			.all() as TypeCount[];
	}
	return db
		.prepare(
			`SELECT a.type, COUNT(*) AS count
       FROM anime a
       WHERE a.type IS NOT NULL
         AND ${WORLD_TOMBSTONE_EXCLUSION}
       GROUP BY a.type
       ORDER BY count DESC`
		)
		.all() as TypeCount[];
}

export interface RatingBucketCounts {
	any: number;
	'8+': number;
	'7+': number;
	'6+': number;
}

export function getRatingBucketCounts(
	db: BetterSqlite3.Database,
	scope: 'my-anime' | 'world-anime'
): RatingBucketCounts {
	const sql =
		scope === 'my-anime'
			? `SELECT a.rating FROM anime a JOIN mylist m ON m.aid = a.aid WHERE 1=1`
			: `SELECT a.rating FROM anime a WHERE ${WORLD_TOMBSTONE_EXCLUSION}`;

	const rows = db.prepare(sql).all() as { rating: number | null }[];
	let any = 0,
		eight = 0,
		seven = 0,
		six = 0;
	for (const r of rows) {
		any++;
		if (r.rating !== null) {
			if (r.rating >= 8) eight++;
			else if (r.rating >= 7) seven++;
			else if (r.rating >= 6) six++;
		}
	}
	return { any, '8+': eight, '7+': seven, '6+': six };
}
