import type BetterSqlite3 from 'better-sqlite3';
import type { WatchStatus } from '../../../types';
import { upsert as upsertMylist, byAid, remove } from '../repositories/mylist';
import { enqueue, type JobKind } from '../repositories/jobs';

const SYNC_STATUSES: WatchStatus[] = ['watching', 'completed', 'dropped'];

export interface JobDescriptor {
	kind: JobKind;
	params: Record<string, unknown>;
}

export function upsertMylistEntry(
	db: BetterSqlite3.Database,
	p: { aid: number; status: WatchStatus; eps_watched?: number; score?: number; notes?: string }
): void {
	const existing = byAid(db, p.aid);
	upsertMylist(db, p);
	if (!SYNC_STATUSES.includes(p.status)) return;
	const state = p.status === 'dropped' ? 3 : 1;
	const viewed: 0 | 1 = p.status === 'completed' ? 1 : 0;
	// Only route through mylist_edit if the entry actually exists on AniDB's side.
	// `existing` (local row present) is not sufficient — a prior failed mylist_add
	// leaves the local row but no AniDB record, and mylist_edit would 600 forever.
	const kind = existing?.anidb_synced_at ? 'mylist_edit' : 'mylist_add';
	enqueue(db, { kind, params: { aid: p.aid, state, viewed }, priority: 1 });
}

export function removeMylistEntry(db: BetterSqlite3.Database, aid: number): void {
	const existing = byAid(db, aid);
	remove(db, aid);
	if (existing?.anidb_synced_at || (existing && SYNC_STATUSES.includes(existing.status as WatchStatus))) {
		enqueue(db, { kind: 'mylist_del', params: { aid }, priority: 1 });
	}
}

/**
 * Bulk-update mylist status for many aids in a single transaction.
 * Returns the number of rows touched and the AniDB sync jobs that should
 * be enqueued AFTER the transaction commits (caller's responsibility, so
 * the caller can hand back the job IDs to the client).
 */
export function bulkSetStatus(
	db: BetterSqlite3.Database,
	aids: number[],
	status: WatchStatus
): { updated: number; jobsToEnqueue: JobDescriptor[] } {
	const jobs: JobDescriptor[] = [];
	let updated = 0;
	const tx = db.transaction(() => {
		for (const aid of aids) {
			const existing = byAid(db, aid);
			upsertMylist(db, { aid, status });
			updated++;
			if (!SYNC_STATUSES.includes(status)) continue;
			const state = status === 'dropped' ? 3 : 1;
			const viewed: 0 | 1 = status === 'completed' ? 1 : 0;
			// Same rule as upsertMylistEntry: edit only when AniDB confirmed the add.
			const kind: JobKind = existing?.anidb_synced_at ? 'mylist_edit' : 'mylist_add';
			jobs.push({ kind, params: { aid, state, viewed } });
		}
	});
	tx();
	return { updated, jobsToEnqueue: jobs };
}

/**
 * Bulk-remove mylist entries. Same transaction semantics as bulkSetStatus.
 */
export function bulkRemove(
	db: BetterSqlite3.Database,
	aids: number[]
): { removed: number; jobsToEnqueue: JobDescriptor[] } {
	const jobs: JobDescriptor[] = [];
	let removed = 0;
	const tx = db.transaction(() => {
		for (const aid of aids) {
			const existing = byAid(db, aid);
			if (!existing) continue;
			remove(db, aid);
			removed++;
			const wasSynced = !!existing.anidb_synced_at;
			const wasSyncable = SYNC_STATUSES.includes(existing.status as WatchStatus);
			if (wasSynced || wasSyncable) {
				jobs.push({ kind: 'mylist_del', params: { aid } });
			}
		}
	});
	tx();
	return { removed, jobsToEnqueue: jobs };
}
