import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime, setDescription } from '../../src/lib/server/db/repositories/anime';
import { upsert as upsertMylist } from '../../src/lib/server/db/repositories/mylist';
import { getDetail } from '../../src/lib/server/db/queries/animeDetail';

describe('getDetail', () => {
	it('returns full detail with mylist when cached', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, {
			aid: 1,
			year: 2026,
			type: 'TV Series',
			picname: 'pic.jpg',
			fetched_at: 1700000000
		});
		setDescription(db, 1, 'A merchant meets a wolf.');
		upsertMylist(db, { aid: 1, status: 'watching' });
		const r = getDetail(db, 1);
		expect(r).not.toBeNull();
		expect(r?.anime.aid).toBe(1);
		expect(r?.anime.description).toBe('A merchant meets a wolf.');
		expect(r?.mylist?.status).toBe('watching');
	});

	it('returns null when uncached', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		expect(getDetail(db, 1)).toBeNull();
	});
});
