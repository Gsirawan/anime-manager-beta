import type BetterSqlite3 from 'better-sqlite3';
import migration001 from './001_initial.sql?raw';
import migration002 from './002_backend_refactor.sql?raw';
import migration003 from './003_per_kind_ttl.sql?raw';
import migration004 from './004_mylist_lid.sql?raw';
import migration005 from './005_origin_backfill_reset.sql?raw';
import migration006 from './006_amask_byte5_backfill_reset.sql?raw';
import migration007 from './007_list_separator_backfill_reset.sql?raw';
import migration008 from './008_skip_redundant_backfill.sql?raw';
import migration009 from './009_backfill_year_from_start_date.sql?raw';
import migration010 from './010_year_fallback_end_date.sql?raw';
import migration011 from './011_clear_epoch_sentinel_dates.sql?raw';

const MIGRATIONS: { version: number; sql: string }[] = [
	{ version: 1, sql: migration001 },
	{ version: 2, sql: migration002 },
	{ version: 3, sql: migration003 },
	{ version: 4, sql: migration004 },
	{ version: 5, sql: migration005 },
	{ version: 6, sql: migration006 },
	{ version: 7, sql: migration007 },
	{ version: 8, sql: migration008 },
	{ version: 9, sql: migration009 },
	{ version: 10, sql: migration010 },
	{ version: 11, sql: migration011 }
];

export function runMigrations(db: BetterSqlite3.Database): void {
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

	db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

	const applied = new Set(
		(db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
			(r) => r.version
		)
	);

	const insert = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

	for (const { version, sql } of MIGRATIONS) {
		if (applied.has(version)) continue;
		const tx = db.transaction(() => {
			db.exec(sql);
			insert.run(version);
		});
		tx();
	}
}
