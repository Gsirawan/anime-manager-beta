import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import * as animeRepo from '../../src/lib/server/db/repositories/anime';
import * as mylistRepo from '../../src/lib/server/db/repositories/mylist';
import * as jobsRepo from '../../src/lib/server/db/repositories/jobs';
import * as titlesRepo from '../../src/lib/server/db/repositories/titles';

let db: BetterSqlite3.Database;
beforeEach(() => {
	db = new Database(':memory:');
	runMigrations(db);
});

describe('animeRepo', () => {
	it('upserts and reads an anime row', () => {
		animeRepo.upsert(db, {
			aid: 1,
			type: 'TV Series',
			episode_count: 12,
			year: 2026,
			picname: 'pic.jpg',
			rating: 8.4
		});
		const row = animeRepo.byAid(db, 1);
		expect(row?.aid).toBe(1);
		expect(row?.rating).toBe(8.4);
	});
});

describe('mylistRepo', () => {
	it('adds and updates a mylist entry', () => {
		animeRepo.upsert(db, { aid: 1 });
		mylistRepo.upsert(db, { aid: 1, status: 'watching' });
		expect(mylistRepo.byAid(db, 1)?.status).toBe('watching');
		mylistRepo.upsert(db, { aid: 1, status: 'completed', eps_watched: 12 });
		expect(mylistRepo.byAid(db, 1)?.status).toBe('completed');
		expect(mylistRepo.byAid(db, 1)?.eps_watched).toBe(12);
	});
	it('removes an entry', () => {
		animeRepo.upsert(db, { aid: 1 });
		mylistRepo.upsert(db, { aid: 1, status: 'watching' });
		mylistRepo.remove(db, 1);
		expect(mylistRepo.byAid(db, 1)).toBeUndefined();
	});
});

describe('jobsRepo', () => {
	it('enqueues, claims, marks done', () => {
		const id = jobsRepo.enqueue(db, { kind: 'anime_fetch', params: { aid: 1 }, priority: 1 });
		const job = jobsRepo.claimNext(db);
		expect(job?.id).toBe(id);
		expect(job?.kind).toBe('anime_fetch');
		expect(job?.status).toBe('running');
		jobsRepo.markDone(db, id);
		expect(jobsRepo.claimNext(db)).toBeUndefined();
	});
	it('orders by priority then created_at', () => {
		const a = jobsRepo.enqueue(db, { kind: 'updated_sync', params: {}, priority: 10 });
		const b = jobsRepo.enqueue(db, { kind: 'anime_fetch', params: { aid: 1 }, priority: 1 });
		expect(jobsRepo.claimNext(db)?.id).toBe(b);
		expect(jobsRepo.claimNext(db)?.id).toBe(a);
	});
});

describe('titlesRepo', () => {
	it('upserts a title and searches via FTS5', () => {
		titlesRepo.upsertMany(db, [
			{ aid: 1, lang: 'en', type: 'main', title: 'Spice and Wolf' },
			{ aid: 2, lang: 'en', type: 'main', title: 'Steins;Gate' }
		]);
		const hits = titlesRepo.search(db, 'spice', 10);
		expect(hits.map((h) => h.aid)).toContain(1);
	});

	it('returns full AnimeCardData shape for cached aids (picname/rating/restricted)', () => {
		// Seed both titles_dump+fts and the anime row so the LEFT JOIN populates.
		titlesRepo.upsertMany(db, [
			{ aid: 100, lang: 'x-jat', type: 'main', title: 'Test Anime' }
		]);
		db.prepare(
			`INSERT INTO anime (aid, type, episode_count, year, picname, rating, restricted, fetched_at)
			 VALUES (100, 'TV Series', 12, 2024, 'test.jpg', 8.5, 1, 1700000000)`
		).run();
		const hits = titlesRepo.search(db, 'test', 10);
		const row = hits.find((h) => h.aid === 100);
		expect(row).toBeDefined();
		expect(row?.type).toBe('TV Series');
		expect(row?.episode_count).toBe(12);
		expect(row?.year).toBe(2024);
		expect(row?.picname).toBe('test.jpg');
		expect(row?.rating).toBe(8.5);
		// Critical for NSFW blur on search-result cards.
		expect(row?.restricted).toBe(1);
	});

	it('returns placeholder fields for uncached aids (titles_dump only, no anime row)', () => {
		titlesRepo.upsertMany(db, [
			{ aid: 200, lang: 'x-jat', type: 'main', title: 'Uncached Anime' }
		]);
		// No anime row — search must still surface the hit.
		const hits = titlesRepo.search(db, 'uncached', 10);
		const row = hits.find((h) => h.aid === 200);
		expect(row).toBeDefined();
		expect(row?.title).toBe('Uncached Anime');
		expect(row?.picname).toBeNull();
		expect(row?.rating).toBeNull();
		expect(row?.restricted).toBeNull();
		expect(row?.mylist_status).toBeNull();
	});

	it('excludes tombstoned aids from search results', () => {
		titlesRepo.upsertMany(db, [
			{ aid: 300, lang: 'x-jat', type: 'main', title: 'Tombstoned Anime' }
		]);
		db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(
			'tombstone_anime_300',
			'non_japanese|1700000000'
		);
		const hits = titlesRepo.search(db, 'tombstoned', 10);
		expect(hits.find((h) => h.aid === 300)).toBeUndefined();
	});

	it('dedupes by aid when multiple language titles match', () => {
		// One aid with 3 indexable variants — all match 'spice'.
		titlesRepo.upsertMany(db, [
			{ aid: 400, lang: 'x-jat', type: 'main', title: 'Spice and Wolf' },
			{ aid: 400, lang: 'en', type: 'main', title: 'Spice And Wolf' },
			{ aid: 400, lang: 'en', type: 'synonym', title: 'Spice Wolf' }
		]);
		const hits = titlesRepo.search(db, 'spice', 10);
		const rows = hits.filter((h) => h.aid === 400);
		expect(rows.length).toBe(1);
	});
});
