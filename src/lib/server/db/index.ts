import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations/runner';
import { logger } from '../logger';

let _db: BetterSqlite3.Database | null = null;

export function openDatabase(path: string): BetterSqlite3.Database {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('synchronous = NORMAL');
	runMigrations(db);
	logger.info({ path }, 'database opened');
	return db;
}

export function getDb(path?: string): BetterSqlite3.Database {
	if (!_db) {
		const cfgPath = path ?? process.env.DATABASE_PATH ?? './data/anime.db';
		_db = openDatabase(cfgPath);
	}
	return _db;
}

export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}
