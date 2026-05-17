import type BetterSqlite3 from 'better-sqlite3';
import type { WatchStatus, AnimeCardData } from '../../../types';

export type SortKey = 'aid' | 'start_date' | 'rating';
export type SortDirection = 'asc' | 'desc';

export interface ListParams {
	tab: 'my' | 'world';
	status?: WatchStatus;
	type?: string;
	genre?: string;
	year?: number;
	/** Filter to anime where `year IS NULL` (the "Unknown" sidebar row).
	 *  Mutually exclusive with `year`; if both set, `year` wins. */
	yearNull?: boolean;
	season?: 'winter' | 'spring' | 'summer' | 'fall';
	rating_min?: number;
	/** Filter `start_date <= this` (unix seconds). Used by the Latest sort
	 *  to drop future-dated anime so they don't sit at the top of "newest
	 *  aired" for months. */
	startDateBefore?: number;
	/** Filter `start_date > this` (unix seconds). Used by the Upcoming sort
	 *  to only show anime that haven't aired yet. */
	startDateAfter?: number;
	q?: string;
	cursor?: string;
	limit?: number;
	/** Sort key — default 'aid'. */
	orderBy?: SortKey;
	/** Sort direction — default 'asc'. */
	direction?: SortDirection;
}

export interface ListResult {
	items: AnimeCardData[];
	nextCursor?: string;
}

/**
 * Maps the user-facing `sort` URL param to ListParams orderBy + direction.
 *
 * Shared by /api/anime, world-anime/+page.server.ts, and any other caller
 * that translates the sidebar's All/Top/Latest/Upcoming choice into a query.
 * Centralised so page 1 (load) and page 2+ (API) cannot drift apart — which
 * is exactly the bug that broke world-anime pagination in v0.1: the API
 * silently fell back to aid/asc while the page used start_date/desc.
 *
 * Returns an empty object when `sort` is missing so callers that don't pass
 * a sort param (e.g. my-anime) keep their existing defaults (aid/asc).
 */
export function sortToOrderParams(
	sort: string | null | undefined,
	nowSec: number = Math.floor(Date.now() / 1000)
): Partial<Pick<ListParams, 'orderBy' | 'direction' | 'startDateBefore' | 'startDateAfter'>> {
	if (!sort) return {};
	if (sort === 'rating') return { orderBy: 'rating', direction: 'desc' };
	if (sort === 'upcoming') {
		// Future-aired only. Without this cutoff, Upcoming would just be
		// All-reversed (oldest first), which is meaningless.
		return { orderBy: 'start_date', direction: 'asc', startDateAfter: nowSec };
	}
	if (sort === 'latest') {
		// Aired/airing only. Without this cutoff, future-dated anime (e.g.
		// 2027 season announcements) sit at the top of Latest for months
		// because they're the latest start_date — but the user wants
		// "what's recently aired", not "what's furthest in the future".
		// Doctrine shift from earlier "pure sorts" stance — Latest needs
		// the cutoff to have any meaning distinct from All.
		return { orderBy: 'start_date', direction: 'desc', startDateBefore: nowSec };
	}
	// 'all' and any unrecognized value → newest-first, no cutoff.
	return { orderBy: 'start_date', direction: 'desc' };
}

// ─── Cursor encoding ───────────────────────────────────────────────────────
//
// Format: `${phase}|${value}|${aid}`
//
//   phase 'a' — non-NULL bucket of the orderBy field. value is the sort
//               field value (as decimal string).
//   phase 'b' — NULL bucket of the orderBy field. Walks rows where the
//               field IS NULL, ordered by aid ASC. value is empty.
//   phase 'c' — aid-only sort. value is empty.
//
// Why two phases for non-aid sorts: ORDER BY <field> {ASC|DESC} NULLS LAST
// traverses non-NULL rows first, then NULL rows. A single keyset cursor on
// the field alone can't cross that boundary — once the cursor's field value
// is NULL, comparisons like `field < ?` return NULL (not true) and exclude
// the NULL rows we want to walk. The phase tag switches WHERE clause shape
// at the boundary.
//
// Backward compat: bare numeric cursors (no `|`) decode as phase 'c'. Any
// old client URL with `?cursor=12345` still works on aid-sorted queries.
type CursorPhase = 'a' | 'b' | 'c';

interface DecodedCursor {
	phase: CursorPhase;
	value: string;
	aid: number;
}

function decodeCursor(s: string): DecodedCursor {
	if (!s.includes('|')) {
		// Legacy bare-aid cursor.
		return { phase: 'c', value: '', aid: Number(s) || 0 };
	}
	const [phase, value, aidStr] = s.split('|');
	const aid = Number(aidStr) || 0;
	if (phase === 'a' || phase === 'b' || phase === 'c') {
		return { phase, value, aid };
	}
	return { phase: 'c', value: '', aid };
}

function encodeCursor(
	lastRow: { aid: number; start_date?: number | null; rating?: number | null },
	orderBy: SortKey
): string {
	if (orderBy === 'aid') return `c||${lastRow.aid}`;
	const v = orderBy === 'start_date' ? lastRow.start_date : lastRow.rating;
	if (v === null || v === undefined) return `b||${lastRow.aid}`;
	return `a|${v}|${lastRow.aid}`;
}

function seasonMonths(s: ListParams['season']): [number, number] | null {
	if (!s) return null;
	const map: Record<string, [number, number]> = {
		winter: [1, 3],
		spring: [4, 6],
		summer: [7, 9],
		fall: [10, 12]
	};
	return map[s] ?? null;
}

export function listAnime(db: BetterSqlite3.Database, p: ListParams): ListResult {
	const where: string[] = [];
	const args: unknown[] = [];
	let from = 'anime a';
	if (p.tab === 'my') {
		from += ' INNER JOIN mylist m ON m.aid = a.aid';
		if (p.status) {
			where.push('m.status = ?');
			args.push(p.status);
		}
	} else {
		// World tab: LEFT JOIN so cards reflect "already in my list" via the
		// heart icon, but the join doesn't filter rows out.
		from += ' LEFT JOIN mylist m ON m.aid = a.aid';
	}
	if (p.type) {
		where.push('a.type = ?');
		args.push(p.type);
	}
	if (p.year) {
		where.push('a.year = ?');
		args.push(p.year);
	} else if (p.yearNull) {
		// "Unknown" sidebar row — anime with no recorded year.
		where.push('a.year IS NULL');
	}
	if (p.startDateBefore !== undefined) {
		// Latest cutoff. NULL start_date rows are excluded by `<=` (NULL
		// comparisons return NULL, treated as false). That's intentional —
		// anime with unknown start_date shouldn't appear in Latest.
		where.push('a.start_date <= ?');
		args.push(p.startDateBefore);
	}
	if (p.startDateAfter !== undefined) {
		// Upcoming cutoff. Same NULL-exclusion semantics.
		where.push('a.start_date > ?');
		args.push(p.startDateAfter);
	}
	if (p.rating_min) {
		where.push('a.rating >= ?');
		args.push(p.rating_min);
	}
	if (p.genre) {
		from += ' INNER JOIN anime_tag t ON t.aid = a.aid';
		where.push('t.tag_name = ?');
		args.push(p.genre);
	}
	const months = seasonMonths(p.season);
	if (months && p.year) {
		where.push("strftime('%m', a.start_date, 'unixepoch') BETWEEN ? AND ?");
		args.push(String(months[0]).padStart(2, '0'), String(months[1]).padStart(2, '0'));
	}
	// Cursor — composite keyset. See encodeCursor / decodeCursor above for the
	// phase tag rationale. The WHERE shape depends on orderBy (aid vs other)
	// and the cursor's phase (non-NULL bucket vs NULL bucket).
	const orderByEffective: SortKey = p.orderBy ?? 'aid';
	const cursorPhase: CursorPhase = p.cursor
		? decodeCursor(p.cursor).phase
		: orderByEffective === 'aid'
			? 'c'
			: 'a';
	if (p.cursor) {
		const c = decodeCursor(p.cursor);
		if (orderByEffective === 'aid') {
			const op = p.direction === 'desc' ? '<' : '>';
			where.push(`a.aid ${op} ?`);
			args.push(c.aid);
		} else if (c.phase === 'b') {
			// NULL bucket — rows where the sort field is NULL, ordered by aid asc.
			where.push(`a.${orderByEffective} IS NULL AND a.aid > ?`);
			args.push(c.aid);
		} else if (c.phase === 'a') {
			// Non-NULL bucket — keyset on (sort field, aid).
			const op = p.direction === 'desc' ? '<' : '>';
			const v = Number(c.value);
			where.push(
				`(a.${orderByEffective} ${op} ? OR (a.${orderByEffective} = ? AND a.aid > ?))`
			);
			args.push(v, v, c.aid);
		} else {
			// phase 'c' (legacy bare-aid) on a non-aid sort — coerce to aid keyset.
			// This loses sort continuity but is the safest fallback for stale URLs.
			where.push('a.aid > ?');
			args.push(c.aid);
		}
	}
	if (p.q) {
		from += ' INNER JOIN anime_title at ON at.aid = a.aid';
		where.push('at.title LIKE ?');
		args.push(`%${p.q}%`);
	}
	// Tombstoned aids:
	//   - world tab: excluded entirely (NOT EXISTS guard below).
	//   - my tab:    kept visible with a `tombstoned` flag so the UI renders
	//                an "Out of scope" badge; user decides whether to remove.
	//
	// Known minor gap: 'banned' tombstones are also treated as terminal here,
	// even after the 14-day backoff expires. preFlightGate handles the expiry
	// on the gate side; the query layer does not. Parked.
	if (p.tab === 'world') {
		where.push(
			`NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tombstone_anime_' || a.aid)`
		);
	}
	const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
	const limit = Math.min(p.limit ?? 50, 200);

	// ORDER BY — caller-controlled. Always tiebreak by aid so pages are stable.
	const direction = p.direction === 'desc' ? 'DESC' : 'ASC';
	const orderSql =
		orderByEffective === 'start_date'
			? `ORDER BY a.start_date ${direction} NULLS LAST, a.aid ASC`
			: orderByEffective === 'rating'
				? `ORDER BY a.rating ${direction} NULLS LAST, a.aid ASC`
				: `ORDER BY a.aid ${direction}`;

	// start_date is selected for cursor encoding only; stripped before items
	// leave this function (AnimeCardData has no start_date field).
	const sql = `
    SELECT DISTINCT a.aid, a.type, a.episode_count, a.year, a.picname, a.rating, a.restricted,
           a.start_date,
           COALESCE(
             (SELECT title FROM anime_title WHERE aid = a.aid AND lang = 'x-jat' AND type = 'main' LIMIT 1),
             (SELECT title FROM anime_title WHERE aid = a.aid LIMIT 1),
             (SELECT title FROM titles_dump WHERE aid = a.aid AND type = 'main' LIMIT 1),
             'aid:' || a.aid
           ) AS title,
           m.status AS mylist_status,
           EXISTS(SELECT 1 FROM meta WHERE key = 'tombstone_anime_' || a.aid) AS tombstoned
    FROM ${from}
    ${whereSql}
    ${orderSql}
    LIMIT ?
  `;
	type RawRow = Omit<AnimeCardData, 'tombstoned'> & {
		tombstoned: number;
		start_date: number | null;
	};
	const rawRows = db.prepare(sql).all(...args, limit) as RawRow[];
	const rows: AnimeCardData[] = rawRows.map((r) => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { start_date: _sd, tombstoned, ...rest } = r;
		return { ...rest, tombstoned: tombstoned === 1 };
	});

	// Next cursor emission. Three cases:
	//   1. Page filled (rows.length === limit) → keyset cursor on last row.
	//      For non-aid sort the cursor's phase reflects whether the last row's
	//      sort field is NULL (phase 'b') or not (phase 'a').
	//   2. Page underfilled AND we were in phase 'a' on a non-aid sort →
	//      emit phase 'b' cursor to start walking the NULL bucket next page.
	//      One wasted round-trip when there are no NULL rows; acceptable.
	//   3. Otherwise → no cursor (end of list).
	let nextCursor: string | undefined;
	if (rawRows.length === limit) {
		nextCursor = encodeCursor(rawRows[rawRows.length - 1], orderByEffective);
	} else if (cursorPhase === 'a' && orderByEffective !== 'aid') {
		nextCursor = 'b||0';
	}
	return { items: rows, nextCursor };
}
