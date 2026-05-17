import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { upsert as upsertMylist } from '../../src/lib/server/db/repositories/mylist';
import { listAnime } from '../../src/lib/server/db/queries/animeList';

describe('listAnime', () => {
	it('returns My Anime tab filtered by status', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1, year: 2026, type: 'TV Series' });
		upsertAnime(db, { aid: 2, year: 2025, type: 'Movie' });
		upsertMylist(db, { aid: 1, status: 'watching' });
		upsertMylist(db, { aid: 2, status: 'completed' });
		const r = listAnime(db, { tab: 'my', status: 'watching', limit: 50 });
		expect(r.items.map((i) => i.aid)).toEqual([1]);
	});
	it('returns World Anime tab filtered by type', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1, year: 2026, type: 'TV Series' });
		upsertAnime(db, { aid: 2, year: 2026, type: 'Movie' });
		const r = listAnime(db, { tab: 'world', type: 'Movie', limit: 50 });
		expect(r.items.map((i) => i.aid)).toEqual([2]);
	});
	it('World Anime cards expose mylist_status via LEFT JOIN (regression: heart icon)', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		upsertAnime(db, { aid: 1, year: 2026, type: 'TV Series' });
		upsertAnime(db, { aid: 2, year: 2026, type: 'TV Series' });
		upsertMylist(db, { aid: 1, status: 'watching' });
		const r = listAnime(db, { tab: 'world', limit: 50 });
		const byAid = Object.fromEntries(r.items.map((i) => [i.aid, i]));
		expect(byAid[1].mylist_status).toBe('watching');
		expect(byAid[2].mylist_status).toBeNull();
	});

	it('paginates via cursor', () => {
		const db = new Database(':memory:');
		runMigrations(db);
		for (let i = 1; i <= 5; i++) upsertAnime(db, { aid: i, year: 2026 });
		const r1 = listAnime(db, { tab: 'world', limit: 2 });
		expect(r1.items.length).toBe(2);
		expect(r1.nextCursor).toBeDefined();
		const r2 = listAnime(db, { tab: 'world', limit: 2, cursor: r1.nextCursor });
		expect(r2.items.length).toBe(2);
	});
});
