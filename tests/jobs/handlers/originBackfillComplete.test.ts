import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { originBackfillComplete } from '../../../src/lib/server/jobs/handlers/originBackfillComplete';
import { getMeta } from '../../../src/lib/server/db/repositories/meta';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';

function makeCtx() {
	const db = new Database(':memory:');
	runMigrations(db);
	return {
		db,
		session: null as never,
		rateLimiter: null as never,
		log: pino({ level: 'silent' }),
		banAttempt: 0,
		lastBanAt: 0
	} as never;
}

describe('originBackfillComplete handler', () => {
	it('sets meta.origin_backfill_done to "1"', async () => {
		const ctx = makeCtx();
		await originBackfillComplete({}, ctx);
		expect(getMeta((ctx as { db: Database.Database }).db, 'origin_backfill_done')).toBe('1');
	});

	it('is idempotent (running twice leaves the flag at "1")', async () => {
		const ctx = makeCtx();
		await originBackfillComplete({}, ctx);
		await originBackfillComplete({}, ctx);
		expect(getMeta((ctx as { db: Database.Database }).db, 'origin_backfill_done')).toBe('1');
	});
});
