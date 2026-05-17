import type BetterSqlite3 from 'better-sqlite3';
import type { AnimeCardData, WatchStatus } from '../../../types';

export interface TitleRow {
	aid: number;
	lang: string;
	type: string;
	title: string;
}

export function upsertMany(db: BetterSqlite3.Database, rows: TitleRow[]): void {
	const dump = db.prepare(
		'INSERT OR IGNORE INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)'
	);
	const fts = db.prepare('INSERT INTO titles_fts (title, aid, lang, type) VALUES (?, ?, ?, ?)');
	const tx = db.transaction((items: TitleRow[]) => {
		for (const r of items) {
			dump.run(r.aid, r.lang, r.type, r.title);
			fts.run(r.title, r.aid, r.lang, r.type);
		}
	});
	tx(rows);
}

/**
 * Search titles via FTS5 and return AnimeCardData rows.
 *
 * Why this shape: search hits are rendered in the same grid as world/my
 * anime listings (AnimeCard component), so they MUST carry picname,
 * rating, restricted, mylist_status. The previous shape only had
 * {aid, title, lang, type} which was cast to AnimeCardData[] in the
 * page loaders — that left NSFW search results UNBLURRED (no `restricted`)
 * and stripped picname / rating from cards. Real bug, surfaced by the
 * deploy agent on 2026-05-16.
 *
 * Behaviour:
 *   - FTS matches multiple title rows per aid (one per matched language).
 *     We DISTINCT-collapse by aid so each anime appears once.
 *   - The displayed title prefers x-jat/main from anime_title (if the aid
 *     has been fetched), then any other anime_title row, then the dump,
 *     then the FTS match text. Same hierarchy as listAnime.
 *   - LEFT JOIN anime / LEFT JOIN mylist so uncached aids still appear
 *     with placeholder fields. Clicking the card navigates to /anime/:aid
 *     which triggers anime_fetch via the cache-miss flow in +page.server.ts.
 *   - Tombstoned aids are EXCLUDED. Search is mostly used for discovery —
 *     surfacing out-of-scope aids would confuse the workflow.
 */
export function search(
	db: BetterSqlite3.Database,
	query: string,
	limit: number
): AnimeCardData[] {
	const q = query.replace(/"/g, '""');
	type RawRow = {
		aid: number;
		title: string;
		type: string | null;
		episode_count: number | null;
		year: number | null;
		picname: string | null;
		rating: number | null;
		restricted: 0 | 1 | null;
		mylist_status: WatchStatus | null;
	};
	// Two-stage query: first stage materialises matched aids from the FTS
	// virtual table; second stage joins anime/mylist/meta on plain rowids.
	// FTS5 column correlation across joins + subqueries is unreliable —
	// keeping the MATCH in its own CTE sidesteps that.
	const rows = db
		.prepare(
			`WITH hits AS (
			   SELECT DISTINCT CAST(aid AS INTEGER) AS aid
			   FROM titles_fts WHERE titles_fts MATCH ?
			   LIMIT ?
			 )
			 SELECT
			   h.aid AS aid,
			   COALESCE(
			     (SELECT t.title FROM anime_title t WHERE t.aid = h.aid AND t.lang = 'x-jat' AND t.type = 'main' LIMIT 1),
			     (SELECT t.title FROM anime_title t WHERE t.aid = h.aid LIMIT 1),
			     (SELECT d.title FROM titles_dump d WHERE d.aid = h.aid AND d.type = 'main' LIMIT 1),
			     (SELECT d2.title FROM titles_dump d2 WHERE d2.aid = h.aid LIMIT 1)
			   ) AS title,
			   a.type AS type,
			   a.episode_count AS episode_count,
			   a.year AS year,
			   a.picname AS picname,
			   a.rating AS rating,
			   a.restricted AS restricted,
			   m.status AS mylist_status
			 FROM hits h
			 LEFT JOIN anime a ON a.aid = h.aid
			 LEFT JOIN mylist m ON m.aid = h.aid
			 WHERE NOT EXISTS (
			   SELECT 1 FROM meta WHERE key = 'tombstone_anime_' || h.aid
			 )`
		)
		.all(`"${q}"*`, limit) as RawRow[];
	// Tombstoned aids are excluded at the WHERE clause above, so every
	// returned row is in-scope. We still ship the field for shape consistency.
	return rows.map((r) => ({ ...r, tombstoned: false }));
}

export function resetFts(db: BetterSqlite3.Database): void {
	db.exec('DELETE FROM titles_fts');
	db.exec(`INSERT INTO titles_fts (title, aid, lang, type)
           SELECT title, aid, lang, type FROM titles_dump`);
}
