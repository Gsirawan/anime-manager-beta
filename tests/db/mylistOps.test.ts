import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { upsert as upsertMylist, byAid } from '../../src/lib/server/db/repositories/mylist';
import { bulkSetStatus, bulkRemove } from '../../src/lib/server/db/queries/mylistOps';

function seed() {
	const db = new Database(':memory:');
	runMigrations(db);
	const now = Math.floor(Date.now() / 1000);
	for (const aid of [1, 2, 3, 4]) {
		upsertAnime(db, { aid, year: 2026, type: 'TV Series', fetched_at: now });
		upsertMylist(db, { aid, status: 'plan' });
	}
	return db;
}

describe('bulkSetStatus', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = seed();
	});

	it('updates rows and enqueues mylist_add when never synced to AniDB (regression: 600 on edit)', () => {
		// Seeded rows are status='plan' with anidb_synced_at=NULL. Flipping to a
		// syncable status must use mylist_add, not mylist_edit — AniDB has no entry
		// to edit and mylist_edit would 600.
		const r = bulkSetStatus(db, [1, 2, 3], 'completed');
		expect(r.updated).toBe(3);
		expect(r.jobsToEnqueue).toHaveLength(3);
		expect(r.jobsToEnqueue.every((j) => j.kind === 'mylist_add')).toBe(true);
		// completed → state=1 viewed=1
		expect(r.jobsToEnqueue[0].params).toMatchObject({ state: 1, viewed: 1 });
		// rows actually updated in DB
		expect(byAid(db, 1)?.status).toBe('completed');
		expect(byAid(db, 3)?.status).toBe('completed');
	});

	it('enqueues mylist_edit only when anidb_synced_at is set', () => {
		// Mark aid 1 as already synced to AniDB; aid 2 remains unsynced.
		db.prepare('UPDATE mylist SET anidb_synced_at = unixepoch() WHERE aid = 1').run();
		const r = bulkSetStatus(db, [1, 2], 'watching');
		const byAidKind = Object.fromEntries(
			r.jobsToEnqueue.map((j) => [(j.params as { aid: number }).aid, j.kind])
		);
		expect(byAidKind[1]).toBe('mylist_edit');
		expect(byAidKind[2]).toBe('mylist_add');
	});

	it('updates rows but enqueues zero jobs for local-only statuses (plan, on_hold)', () => {
		const r = bulkSetStatus(db, [1, 2], 'on_hold');
		expect(r.updated).toBe(2);
		expect(r.jobsToEnqueue).toHaveLength(0);
		expect(byAid(db, 1)?.status).toBe('on_hold');
	});

	it('dropped status maps to AniDB state=3', () => {
		const r = bulkSetStatus(db, [1], 'dropped');
		expect(r.jobsToEnqueue[0].params).toMatchObject({ state: 3 });
	});

	it('watching status maps to state=1 viewed=0', () => {
		const r = bulkSetStatus(db, [1], 'watching');
		expect(r.jobsToEnqueue[0].params).toMatchObject({ state: 1, viewed: 0 });
	});

	it('first-time bulk insert (no prior mylist row) uses mylist_add', () => {
		const db2 = new Database(':memory:');
		runMigrations(db2);
		const now = Math.floor(Date.now() / 1000);
		upsertAnime(db2, { aid: 99, year: 2026, type: 'TV Series', fetched_at: now });
		const r = bulkSetStatus(db2, [99], 'watching');
		expect(r.jobsToEnqueue[0].kind).toBe('mylist_add');
	});
});

describe('bulkRemove', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = seed();
	});

	it('removes existing rows and enqueues nothing for never-synced plan items', () => {
		const r = bulkRemove(db, [1, 2]);
		expect(r.removed).toBe(2);
		// plan items never get synced → no del job needed
		expect(r.jobsToEnqueue).toHaveLength(0);
		expect(byAid(db, 1)).toBeUndefined();
		expect(byAid(db, 2)).toBeUndefined();
	});

	it('enqueues mylist_del for previously-synced items', () => {
		// flip aid 1 to watching so it's a sync-able status
		upsertMylist(db, { aid: 1, status: 'watching' });
		const r = bulkRemove(db, [1]);
		expect(r.removed).toBe(1);
		expect(r.jobsToEnqueue).toHaveLength(1);
		expect(r.jobsToEnqueue[0]).toMatchObject({ kind: 'mylist_del', params: { aid: 1 } });
	});

	it('ignores aids that are not in mylist', () => {
		const r = bulkRemove(db, [999, 1000]);
		expect(r.removed).toBe(0);
		expect(r.jobsToEnqueue).toHaveLength(0);
	});
});
