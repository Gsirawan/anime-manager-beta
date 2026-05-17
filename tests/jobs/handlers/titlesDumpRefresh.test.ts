import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { titlesDumpRefresh } from '../../../src/lib/server/jobs/handlers/titlesDumpRefresh';
import { setMeta } from '../../../src/lib/server/db/repositories/meta';

// Hoisted mock — accessed by both tests.
const downloadMock = vi.fn();
vi.mock('../../../src/lib/server/anidb/titlesDump', () => ({
	downloadTitles: (...args: unknown[]) => downloadMock(...args)
}));

function mkCtx(db: Database.Database) {
	return {
		db,
		session: null as any,
		rateLimiter: new RateLimiter({ intervalMs: 0 }),
		log: pino({ level: 'silent' }),
		banAttempt: 0,
		lastBanAt: 0
	};
}

afterEach(() => {
	downloadMock.mockReset();
});

describe('titlesDumpRefresh handler', () => {
	it('writes rows to titles_dump and resets FTS', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		downloadMock.mockResolvedValueOnce({
			rows: [{ aid: 1, lang: 'x-jat', type: 'main', title: 'Spice and Wolf' }],
			notModified: false,
			etag: 'abc'
		});
		await titlesDumpRefresh({}, mkCtx(db));
		const hit = db.prepare("SELECT aid FROM titles_dump WHERE title = 'Spice and Wolf'").get();
		expect(hit).toBeDefined();
	});

	it('skips the HTTP request when <24h since last run (AniDB rate-limit compliance)', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const recent = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
		setMeta(db, 'titles_dump_last_at', String(recent));
		await titlesDumpRefresh({}, mkCtx(db));
		expect(downloadMock).not.toHaveBeenCalled();
	});

	it('runs after 24h+ since last run', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		const longAgo = Math.floor(Date.now() / 1000) - 25 * 3600;
		setMeta(db, 'titles_dump_last_at', String(longAgo));
		downloadMock.mockResolvedValueOnce({ rows: [], notModified: false });
		await titlesDumpRefresh({}, mkCtx(db));
		expect(downloadMock).toHaveBeenCalledTimes(1);
	});

	it('stamps titles_dump_last_at even on a 304 not-modified response', async () => {
		const db = new Database(':memory:');
		runMigrations(db);
		downloadMock.mockResolvedValueOnce({ rows: [], notModified: true });
		const beforeSec = Math.floor(Date.now() / 1000);
		await titlesDumpRefresh({}, mkCtx(db));
		const stamp = Number(
			(
				db.prepare(`SELECT value FROM meta WHERE key = 'titles_dump_last_at'`).get() as {
					value: string;
				}
			).value
		);
		expect(stamp).toBeGreaterThanOrEqual(beforeSec);
	});
});
