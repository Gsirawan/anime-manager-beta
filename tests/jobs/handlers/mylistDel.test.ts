import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { mylistDel } from '../../../src/lib/server/jobs/handlers/mylistDel';

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

describe('mylistDel handler', () => {
	it('issues a state=3 generic edit (soft-delete on AniDB)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const { ctx, transport } = mkCtx(db, [
			'200 LOGIN ACCEPTED sKey\n',
			'311 MYLIST ENTRY EDITED\n'
		]);
		await expect(mylistDel({ aid: 1 }, ctx)).resolves.toBeUndefined();
		const cmd = transport.sent[transport.sent.length - 1].toString();
		expect(cmd).toContain('MYLISTADD aid=1');
		expect(cmd).toContain('generic=1');
		expect(cmd).toContain('edit=1');
		expect(cmd).toContain('state=3');
	});

	it('treats 411 NO SUCH MYLIST ENTRY as success (nothing to mark)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const { ctx } = mkCtx(db, ['200 LOGIN ACCEPTED sKey\n', '411 NO SUCH MYLIST ENTRY\n']);
		await expect(mylistDel({ aid: 1 }, ctx)).resolves.toBeUndefined();
	});
});
