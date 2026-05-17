import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/server/db/migrations/runner';
import {
	loadBanState,
	saveBanState,
	recordCommand,
	recordBan,
	type BanState
} from '../../src/lib/server/jobs/banState';

function freshDb() {
	const db = new Database(':memory:');
	runMigrations(db);
	return db;
}

describe('banState', () => {
	it('returns zero-state when nothing has been persisted', () => {
		const db = freshDb();
		const s = loadBanState(db);
		expect(s).toEqual({ pausedUntil: 0, banAttempt: 0, lastCommandAt: 0 });
	});

	it('round-trips a written state', () => {
		const db = freshDb();
		const written: BanState = {
			pausedUntil: 1_700_000_000_000,
			banAttempt: 3,
			lastCommandAt: 1_700_000_000_000
		};
		saveBanState(db, written);
		expect(loadBanState(db)).toEqual(written);
	});

	it('recordCommand writes lastCommandAt without touching pause/attempt', () => {
		const db = freshDb();
		saveBanState(db, { pausedUntil: 42, banAttempt: 5, lastCommandAt: 99 });
		recordCommand(db, 12345);
		expect(loadBanState(db)).toEqual({ pausedUntil: 42, banAttempt: 5, lastCommandAt: 12345 });
	});

	it('recordBan writes pausedUntil + banAttempt without touching lastCommandAt', () => {
		const db = freshDb();
		saveBanState(db, { pausedUntil: 0, banAttempt: 0, lastCommandAt: 7777 });
		recordBan(db, 8888, 2);
		expect(loadBanState(db)).toEqual({ pausedUntil: 8888, banAttempt: 2, lastCommandAt: 7777 });
	});
});
