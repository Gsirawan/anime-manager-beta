import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { animeDescFetch } from '../../../src/lib/server/jobs/handlers/animeDescFetch';

function mkCtx(replies: string[]) {
	const db = new Database(':memory:');
	runMigrations(db);
	db.prepare(`INSERT INTO anime (aid) VALUES (1)`).run();
	const transport = new FakeTransport(replies.map((r) => Buffer.from(r)));
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

describe('animeDescFetch', () => {
	it('loops parts and concatenates the description', async () => {
		// Reply body format: "part|maxParts|text"
		const { db, ctx } = mkCtx([
			'233 ANIMEDESC\n0|2|Hello \n',
			'233 ANIMEDESC\n1|2|world.\n'
		]);
		await animeDescFetch({ aid: 1 }, ctx);
		const row = db
			.prepare(`SELECT description, desc_fetched_at FROM anime WHERE aid = 1`)
			.get() as { description: string; desc_fetched_at: number };
		expect(row.description).toBe('Hello world.');
		expect(row.desc_fetched_at).toBeGreaterThan(0);
	});

	it('no-ops on 312 NO DATA but stamps desc_fetched_at', async () => {
		const { db, ctx } = mkCtx(['312 NO DATA\n']);
		await animeDescFetch({ aid: 1 }, ctx);
		const row = db
			.prepare(`SELECT description, desc_fetched_at FROM anime WHERE aid = 1`)
			.get() as { description: string | null; desc_fetched_at: number };
		expect(row.description).toBeNull();
		expect(row.desc_fetched_at).toBeGreaterThan(0);
	});

	it('writes desc_last_attempt_at before sending (NOT the shared last_attempt_at)', async () => {
		const { db, ctx } = mkCtx(['233 ANIMEDESC\n0|1|x\n']);
		await animeDescFetch({ aid: 1 }, ctx);
		const row = db
			.prepare(`SELECT last_attempt_at, desc_last_attempt_at FROM anime WHERE aid = 1`)
			.get() as { last_attempt_at: number | null; desc_last_attempt_at: number };
		expect(row.desc_last_attempt_at).toBeGreaterThan(0);
		// We must NOT touch the anime_fetch column — they're independent now.
		expect(row.last_attempt_at).toBeNull();
	});
});
