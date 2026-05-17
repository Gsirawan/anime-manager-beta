import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { upsert as upsertMylist } from '../../src/lib/server/db/repositories/mylist';

// Mock getDb to return our in-memory test DB. Vitest hoists vi.mock calls,
// so the mock factory closes over a top-level variable.
let testDb: Database.Database;
vi.mock('$lib/server/db', () => ({
	getDb: () => testDb
}));

// Import AFTER the mock is registered.
const { POST } = await import('../../src/routes/api/mylist/bulk/+server');

function makeRequest(body: unknown): Request {
	return new Request('http://localhost/api/mylist/bulk', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function callPost(body: unknown): Promise<{ status: number; json: any }> {
	const res = await (POST as any)({ request: makeRequest(body) });
	return { status: res.status, json: await res.json() };
}

describe('POST /api/mylist/bulk', () => {
	beforeEach(() => {
		testDb = new Database(':memory:');
		runMigrations(testDb);
		const now = Math.floor(Date.now() / 1000);
		for (const aid of [1, 2, 3, 4]) {
			upsertAnime(testDb, { aid, year: 2026, type: 'TV Series', fetched_at: now });
			upsertMylist(testDb, { aid, status: 'plan' });
		}
	});

	it('set_status: updates rows and enqueues mylist_add when never synced (regression)', async () => {
		// Seeded rows have anidb_synced_at=NULL → must go via mylist_add, not edit.
		const r = await callPost({ aids: [1, 2, 3], action: 'set_status', status: 'completed' });
		expect(r.status).toBe(200);
		expect(r.json.ok).toBe(true);
		expect(r.json.data.updated).toBe(3);
		expect(r.json.data.enqueued_jobs).toHaveLength(3);
		const jobs = testDb.prepare("SELECT kind FROM job WHERE status='pending'").all() as {
			kind: string;
		}[];
		expect(jobs.map((j) => j.kind).every((k) => k === 'mylist_add')).toBe(true);
	});

	it('set_status to on_hold: updates rows but enqueues no jobs (local-only)', async () => {
		const r = await callPost({ aids: [1, 2], action: 'set_status', status: 'on_hold' });
		expect(r.json.data.updated).toBe(2);
		expect(r.json.data.enqueued_jobs).toHaveLength(0);
	});

	it('remove: deletes rows and enqueues mylist_del for sync-able items', async () => {
		// First flip aid 1 to watching so removal triggers a del job
		upsertMylist(testDb, { aid: 1, status: 'watching' });
		const r = await callPost({ aids: [1, 2], action: 'remove' });
		expect(r.json.data.removed).toBe(2);
		// aid 1 was watching → del enqueued; aid 2 was plan → no del needed
		expect(r.json.data.enqueued_jobs).toHaveLength(1);
	});

	it('rejects empty aids array', async () => {
		const r = await callPost({ aids: [], action: 'set_status', status: 'plan' });
		expect(r.status).toBe(400);
		expect(r.json.ok).toBe(false);
		expect(r.json.error.code).toBe('bad_input');
	});

	it('rejects set_status without status field', async () => {
		const r = await callPost({ aids: [1], action: 'set_status' });
		expect(r.status).toBe(400);
	});

	it('rejects invalid action', async () => {
		const r = await callPost({ aids: [1], action: 'destroy' });
		expect(r.status).toBe(400);
	});

	it('rejects too many aids (limit 500)', async () => {
		const aids = Array.from({ length: 501 }, (_, i) => i + 1);
		const r = await callPost({ aids, action: 'set_status', status: 'plan' });
		expect(r.status).toBe(400);
	});
});
