import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { updatedSync } from '../../../src/lib/server/jobs/handlers/updatedSync';
import { setMeta } from '../../../src/lib/server/db/repositories/meta';

function mkCtx(reply: string) {
	const db = new Database(':memory:');
	runMigrations(db);
	const transport = new FakeTransport([Buffer.from(reply)]);
	const session = new Session(transport as any, {
		user: 'u',
		pass: 'p',
		client: 'c',
		clientver: 1
	});
	session.key = 'KEY';
	return {
		db,
		ctx: {
			db,
			session,
			rateLimiter: new RateLimiter({ intervalMs: 2100 }),
			log: pino({ level: 'silent' }),
			banAttempt: 0,
			lastBanAt: 0
		} as any
	};
}

describe('updatedSync', () => {
	it('enqueues an anime_fetch per aid returned', async () => {
		const { db, ctx } = mkCtx('243 UPDATED\n1|3|1700000000|100,200,300\n');
		await updatedSync({}, ctx);
		const jobs = db
			.prepare(`SELECT kind, params_json FROM job WHERE kind='anime_fetch' ORDER BY id`)
			.all() as { kind: string; params_json: string }[];
		expect(jobs.length).toBe(3);
		expect(jobs.map((j) => JSON.parse(j.params_json).aid)).toEqual([100, 200, 300]);
	});

	it('self-rate-limits to 72h via updated_last_run_at', async () => {
		const { db, ctx } = mkCtx('243 UPDATED\n1|3|1700000000|100,200,300\n');
		const recent = Math.floor(Date.now() / 1000) - 60; // ran 60s ago
		setMeta(db, 'updated_last_run_at', String(recent));
		await updatedSync({}, ctx);
		const jobs = db.prepare(`SELECT id FROM job WHERE kind='anime_fetch'`).all();
		expect(jobs.length).toBe(0); // skipped because <72h
	});

	it('records updated_last_run_at after a 343 NO UPDATES run', async () => {
		const { db, ctx } = mkCtx('343 NO UPDATES\n');
		await updatedSync({}, ctx);
		const meta = db
			.prepare(`SELECT value FROM meta WHERE key = 'updated_last_run_at'`)
			.get() as { value: string } | undefined;
		expect(Number(meta?.value)).toBeGreaterThan(0);
	});

	it('runs after 72h+ since the last run', async () => {
		const { db, ctx } = mkCtx('243 UPDATED\n1|2|1700000000|500,600\n');
		const longAgo = Math.floor(Date.now() / 1000) - 73 * 3600;
		setMeta(db, 'updated_last_run_at', String(longAgo));
		await updatedSync({}, ctx);
		const jobs = db.prepare(`SELECT id FROM job WHERE kind='anime_fetch'`).all();
		expect(jobs.length).toBe(2);
	});
});
