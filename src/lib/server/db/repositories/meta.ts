import type BetterSqlite3 from 'better-sqlite3';

export function getMeta(db: BetterSqlite3.Database, key: string): string | null {
	const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return r?.value ?? null;
}

export function setMeta(db: BetterSqlite3.Database, key: string, value: string): void {
	db.prepare(
		'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

/**
 * Batched tombstone lookup. Returns the subset of `aids` that currently
 * have a meta key `tombstone_anime_<aid>` set (any reason). Used at the
 * query layer to exclude tombstoned aids from search / world / detail
 * results without per-aid round-trips.
 *
 * Implementation: one SELECT with a placeholder per aid. SQLite limits
 * the number of placeholders to ~32k by default — comfortably above
 * any list we'd pass here. If the aid list is empty, returns empty
 * without hitting the DB.
 */
export function tombstonedAids(
	db: BetterSqlite3.Database,
	aids: number[]
): Set<number> {
	if (aids.length === 0) return new Set();
	const placeholders = aids.map(() => '?').join(',');
	const keys = aids.map((aid) => `tombstone_anime_${aid}`);
	const rows = db
		.prepare(`SELECT key FROM meta WHERE key IN (${placeholders})`)
		.all(...keys) as { key: string }[];
	const out = new Set<number>();
	for (const r of rows) {
		const aid = Number(r.key.slice('tombstone_anime_'.length));
		if (Number.isFinite(aid)) out.add(aid);
	}
	return out;
}
