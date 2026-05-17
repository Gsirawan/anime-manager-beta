import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { upsert as upsertAnime } from '../../../src/lib/server/db/repositories/anime';
import {
	upsert as upsertMylist,
	byAid as mylistByAid
} from '../../../src/lib/server/db/repositories/mylist';
import { mylistEdit } from '../../../src/lib/server/jobs/handlers/mylistEdit';

function mkCtx(db: Database.Database, replies: string[]) {
	const t = new FakeTransport(replies.map((r) => Buffer.from(r)));
	const session = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
	return {
		ctx: {
			db,
			session,
			rateLimiter: new RateLimiter({ intervalMs: 0 }),
			log: pino({ level: 'silent' }),
			banAttempt: 0,
			lastBanAt: 0
		} as any,
		transport: t
	};
}

describe('mylistEdit handler', () => {
	it('issues MYLISTADD aid=X&generic=1&epno=1&edit=1 and marks synced', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylist(db, { aid: 1, status: 'completed' });
		const { ctx, transport } = mkCtx(db, [
			'200 LOGIN ACCEPTED sKey\n',
			'311 MYLIST ENTRY EDITED\n'
		]);
		await mylistEdit({ aid: 1, state: 1, viewed: 1 }, ctx);
		const cmd = transport.sent[transport.sent.length - 1].toString();
		expect(cmd).toContain('MYLISTADD aid=1');
		expect(cmd).toContain('generic=1');
		expect(cmd).toContain('epno=1');
		expect(cmd).toContain('edit=1');
		expect(mylistByAid(db, 1)?.anidb_synced_at).toBeTruthy();
	});

	it('falls back to mylist_add when AniDB returns 411 (entry gone out-of-band)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylist(db, { aid: 1, status: 'watching' });
		const { ctx, transport } = mkCtx(db, [
			'200 LOGIN ACCEPTED sKey\n',
			'411 NO SUCH MYLIST ENTRY\n',
			'210 MYLIST ENTRY ADDED\n1\n'
		]);
		await mylistEdit({ aid: 1, state: 1, viewed: 0 }, ctx);
		// Two outgoing packets: the failed edit, then the recovery add
		const sentTexts = transport.sent.map((b) => b.toString());
		const editAttempts = sentTexts.filter((s) => s.includes('edit=1'));
		const addAttempts = sentTexts.filter(
			(s) => s.includes('MYLISTADD') && !s.includes('edit=1')
		);
		expect(editAttempts.length).toBe(1);
		expect(addAttempts.length).toBe(1);
		expect(mylistByAid(db, 1)?.anidb_synced_at).toBeTruthy();
	});
});
