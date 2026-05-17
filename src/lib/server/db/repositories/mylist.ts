import type BetterSqlite3 from 'better-sqlite3';

export type WatchStatus = 'plan' | 'watching' | 'completed' | 'on_hold' | 'dropped';
export interface MylistRow {
	aid: number;
	status: WatchStatus;
	eps_watched: number;
	score: number | null;
	notes: string | null;
	added_at: number;
	updated_at: number;
	anidb_mylist_state: number | null;
	anidb_synced_at: number | null;
	anidb_lid: number | null;
}

export function upsert(
	db: BetterSqlite3.Database,
	row: { aid: number; status: WatchStatus; eps_watched?: number; score?: number; notes?: string }
): void {
	db.prepare(
		`
    INSERT INTO mylist (aid, status, eps_watched, score, notes)
    VALUES (@aid, @status, @eps_watched, @score, @notes)
    ON CONFLICT(aid) DO UPDATE SET
      status = excluded.status,
      eps_watched = COALESCE(excluded.eps_watched, mylist.eps_watched),
      score = COALESCE(excluded.score, mylist.score),
      notes = COALESCE(excluded.notes, mylist.notes),
      updated_at = unixepoch()
  `
	).run({
		aid: row.aid,
		status: row.status,
		eps_watched: row.eps_watched ?? 0,
		score: row.score ?? null,
		notes: row.notes ?? null
	});
}

export function byAid(db: BetterSqlite3.Database, aid: number): MylistRow | undefined {
	return db.prepare('SELECT * FROM mylist WHERE aid = ?').get(aid) as MylistRow | undefined;
}

export function remove(db: BetterSqlite3.Database, aid: number): void {
	db.prepare('DELETE FROM mylist WHERE aid = ?').run(aid);
}

export function markSynced(db: BetterSqlite3.Database, aid: number, state: number): void {
	// Note: `anidb_lid` column is intentionally left unset. Generic mylist
	// adds return an entry-count in the 210 body, not a lid, and AniDB does
	// not expose lid for animeinfo adds without a follow-up MYLIST query.
	// All subsequent edits/deletes target by composite (aid+generic+epno).
	db.prepare(
		'UPDATE mylist SET anidb_mylist_state = ?, anidb_synced_at = unixepoch() WHERE aid = ?'
	).run(state, aid);
}
