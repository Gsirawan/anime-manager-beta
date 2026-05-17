import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/lib/server/db';

let tmpDir = '';
afterEach(() => {
	if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('openDatabase', () => {
	it('opens a database, runs migrations, returns a working connection', () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'animedb-'));
		const dbPath = join(tmpDir, 'anime.db');
		const db = openDatabase(dbPath);
		const row = db.prepare('SELECT COUNT(*) as n FROM schema_migrations').get() as { n: number };
		expect(row.n).toBeGreaterThan(0);
		db.close();
	});
});
