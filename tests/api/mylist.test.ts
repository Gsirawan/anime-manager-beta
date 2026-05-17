import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { byAid as mylistByAid } from '../../src/lib/server/db/repositories/mylist';
import { upsertMylistEntry, removeMylistEntry } from '../../src/lib/server/db/queries/mylistOps';

describe('mylistOps', () => {
	it('upsert creates a local row and enqueues mylist_add for synced statuses', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylistEntry(db, { aid: 1, status: 'watching' });
		expect(mylistByAid(db, 1)?.status).toBe('watching');
		const pending = db.prepare("SELECT kind FROM job WHERE status='pending'").all() as {
			kind: string;
		}[];
		expect(pending.map((p) => p.kind)).toContain('mylist_add');
	});
	it('upsert does NOT enqueue for plan or on_hold (local-only statuses)', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylistEntry(db, { aid: 1, status: 'plan' });
		const pending = db.prepare("SELECT kind FROM job WHERE status='pending'").all();
		expect(pending.length).toBe(0);
	});
	it('remove deletes the row and enqueues mylist_del when previously synced', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylistEntry(db, { aid: 1, status: 'watching' });
		removeMylistEntry(db, 1);
		expect(mylistByAid(db, 1)).toBeUndefined();
		const pending = db.prepare("SELECT kind FROM job WHERE status='pending'").all() as {
			kind: string;
		}[];
		expect(pending.map((p) => p.kind)).toContain('mylist_del');
	});
});
