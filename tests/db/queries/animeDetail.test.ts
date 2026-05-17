import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { getDetail } from '../../../src/lib/server/db/queries/animeDetail';

function freshDb(): BetterSqlite3.Database {
	const db = new Database(':memory:');
	runMigrations(db);
	return db;
}

describe('getDetail — title sort order', () => {
	let db: BetterSqlite3.Database;
	beforeEach(() => {
		db = freshDb();
		// Seed the anime row with fetched_at so getDetail returns it.
		db.prepare(
			`INSERT INTO anime (aid, type, fetched_at) VALUES (1, 'TV Series', 1)`
		).run();
		// Seed titles in non-canonical insertion order so we know the ORDER BY
		// is doing the work (not the SELECT order).
		const ins = db.prepare(
			`INSERT INTO anime_title (aid, lang, type, title) VALUES (?, ?, ?, ?)`
		);
		ins.run(1, 'en', 'other', 'Crest of the Stars (US)');
		ins.run(1, 'en', 'synonym', 'Banner of the Stars (alt)');
		ins.run(1, 'x-jat', 'short', 'SnM');
		ins.run(1, 'en', 'main', 'Crest of the Stars');
		ins.run(1, 'ja', 'main', '星界の紋章');
		ins.run(1, 'x-jat', 'main', 'Seikai no Monshou');
		ins.run(1, 'en', 'synonym', 'Hoshi no Monshou');
	});

	it('returns titles ordered by type priority (main → synonym → short → other), then lang, then title', () => {
		const detail = getDetail(db, 1);
		expect(detail).not.toBeNull();
		const seq = detail!.titles.map((t) => `${t.type}/${t.lang}/${t.title}`);
		expect(seq).toEqual([
			// type=main, lang asc, title asc
			'main/en/Crest of the Stars',
			'main/ja/星界の紋章',
			'main/x-jat/Seikai no Monshou',
			// type=synonym, lang asc, title asc
			'synonym/en/Banner of the Stars (alt)',
			'synonym/en/Hoshi no Monshou',
			// type=short, lang asc, title asc
			'short/x-jat/SnM',
			// type=other, lang asc, title asc
			'other/en/Crest of the Stars (US)'
		]);
	});
});
