import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { setMeta, tombstonedAids } from '../../src/lib/server/db/repositories/meta';

function freshDb(): BetterSqlite3.Database {
	const db = new Database(':memory:');
	db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);`);
	return db;
}

describe('tombstonedAids', () => {
	let db: BetterSqlite3.Database;
	beforeEach(() => {
		db = freshDb();
	});

	it('returns an empty Set when no aids are tombstoned', () => {
		const result = tombstonedAids(db, [1, 2, 3]);
		expect(result).toEqual(new Set());
	});

	it('returns only the aids whose tombstone meta key exists', () => {
		setMeta(db, 'tombstone_anime_2', `non_japanese|${Date.now()}`);
		setMeta(db, 'tombstone_anime_5', `no_such_anime|${Date.now()}`);
		const result = tombstonedAids(db, [1, 2, 3, 4, 5]);
		expect(result).toEqual(new Set([2, 5]));
	});

	it('returns empty Set when asked about zero aids', () => {
		const result = tombstonedAids(db, []);
		expect(result).toEqual(new Set());
	});

	it('handles a large aid list in one query', () => {
		const aids = Array.from({ length: 500 }, (_, i) => i + 1);
		setMeta(db, 'tombstone_anime_42', `non_japanese|${Date.now()}`);
		setMeta(db, 'tombstone_anime_300', `banned|${Date.now()}`);
		const result = tombstonedAids(db, aids);
		expect(result).toEqual(new Set([42, 300]));
	});
});
