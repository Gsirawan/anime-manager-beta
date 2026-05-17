import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import { upsert as upsertAnime } from '../../src/lib/server/db/repositories/anime';
import { upsertMany } from '../../src/lib/server/db/repositories/titles';

const path = process.argv[2];
if (!path) {
	console.error('usage: seed.ts <db_path>');
	process.exit(1);
}
const db = new Database(path);
runMigrations(db);
// Clear mutable tables so the test starts from a known state
db.exec('DELETE FROM mylist');
upsertAnime(db, {
	aid: 1,
	year: 2026,
	type: 'TV Series',
	picname: 'placeholder.jpg',
	rating: 8.4,
	episode_count: 12,
	start_date: Math.floor(Date.now() / 1000) - 86400,
	end_date: Math.floor(Date.now() / 1000) - 100,
	fetched_at: Math.floor(Date.now() / 1000)
});
upsertMany(db, [{ aid: 1, lang: 'x-jat', type: 'main', title: 'Spice and Wolf' }]);
db.close();
console.log('seeded', path);
