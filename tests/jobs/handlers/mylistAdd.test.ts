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
import { mylistAdd } from '../../../src/lib/server/jobs/handlers/mylistAdd';

describe('mylistAdd handler', () => {
	it('calls MYLISTADD and marks synced_at on the local mylist row', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1 });
		upsertMylist(db, { aid: 1, status: 'watching' });
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			// Body "1" is the entry-count for animeinfo adds — must NOT be parsed as a lid.
			Buffer.from('210 MYLIST ENTRY ADDED\n1\n')
		]);
		const session = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await mylistAdd(
			{ aid: 1, state: 1, viewed: 0 },
			{
				db,
				session,
				rateLimiter: new RateLimiter({ intervalMs: 0 }),
				log: pino({ level: 'silent' }),
				banAttempt: 0,
				lastBanAt: 0
			}
		);
		const row = mylistByAid(db, 1);
		expect(row?.anidb_synced_at).toBeTruthy();
		expect(row?.anidb_mylist_state).toBe(1);
		// lid stays NULL — we no longer trust the 210 body for it
		expect(row?.anidb_lid).toBeNull();
	});
});
