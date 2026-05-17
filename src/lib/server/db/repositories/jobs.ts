import type BetterSqlite3 from 'better-sqlite3';

export type JobKind =
	| 'anime_fetch'
	| 'anime_desc_fetch'
	| 'updated_sync'
	| 'mylist_add'
	| 'mylist_del'
	| 'mylist_edit'
	| 'character_fetch'
	| 'titles_dump_refresh'
	| 'origin_backfill_complete';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
	id: number;
	kind: JobKind;
	params_json: string;
	priority: number;
	status: JobStatus;
	attempts: number;
	last_error: string | null;
	created_at: number;
	started_at: number | null;
	completed_at: number | null;
}

export interface ClaimedJob<P = unknown> {
	id: number;
	kind: JobKind;
	params: P;
	attempts: number;
	status: JobStatus;
}

export function enqueue(
	db: BetterSqlite3.Database,
	j: { kind: JobKind; params: unknown; priority?: number }
): number {
	const info = db
		.prepare('INSERT INTO job (kind, params_json, priority) VALUES (?, ?, ?)')
		.run(j.kind, JSON.stringify(j.params), j.priority ?? 10);
	return Number(info.lastInsertRowid);
}

export function claimNext(db: BetterSqlite3.Database): ClaimedJob | undefined {
	const tx = db.transaction(() => {
		const row = db
			.prepare(
				"SELECT * FROM job WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT 1"
			)
			.get() as JobRow | undefined;
		if (!row) return undefined;
		db.prepare(
			"UPDATE job SET status = 'running', started_at = unixepoch(), attempts = attempts + 1 WHERE id = ?"
		).run(row.id);
		return {
			id: row.id,
			kind: row.kind,
			params: JSON.parse(row.params_json),
			attempts: row.attempts + 1,
			status: 'running' as JobStatus
		};
	});
	return tx();
}

export function markDone(db: BetterSqlite3.Database, id: number): void {
	db.prepare("UPDATE job SET status = 'done', completed_at = unixepoch() WHERE id = ?").run(id);
}

export function markFailed(
	db: BetterSqlite3.Database,
	id: number,
	error: string,
	retry: boolean
): void {
	const status: JobStatus = retry ? 'pending' : 'failed';
	db.prepare(
		"UPDATE job SET status = ?, last_error = ?, completed_at = CASE WHEN ? = 'failed' THEN unixepoch() ELSE NULL END WHERE id = ?"
	).run(status, error, status, id);
}

export function pendingCount(db: BetterSqlite3.Database): number {
	const r = db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'pending'").get() as {
		n: number;
	};
	return r.n;
}
