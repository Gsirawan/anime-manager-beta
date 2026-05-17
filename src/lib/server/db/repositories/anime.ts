import type BetterSqlite3 from 'better-sqlite3';

export interface AnimeRow {
	aid: number;
	type: string | null;
	episode_count: number | null;
	start_date: number | null;
	end_date: number | null;
	year: number | null;
	picname: string | null;
	rating: number | null;
	vote_count: number | null;
	temp_rating: number | null;
	url: string | null;
	restricted: number;
	description: string | null;
	fetched_at: number | null;
	desc_fetched_at: number | null;
	updated_at: number;
}

export function upsert(db: BetterSqlite3.Database, row: Partial<AnimeRow> & { aid: number }): void {
	const cols = Object.keys(row).filter((k) => k !== 'aid');
	const colsList = ['aid', ...cols].join(', ');
	const placeholders = ['?', ...cols.map(() => '?')].join(', ');
	const values = [row.aid, ...cols.map((c) => (row as Record<string, unknown>)[c] ?? null)];
	const updateClause =
		cols.length > 0
			? cols.map((c) => `${c} = excluded.${c}`).join(', ') + ', updated_at = unixepoch()'
			: 'updated_at = unixepoch()';
	const sql = `INSERT INTO anime (${colsList}) VALUES (${placeholders})
               ON CONFLICT(aid) DO UPDATE SET ${updateClause}`;
	db.prepare(sql).run(...values);
}

export function byAid(db: BetterSqlite3.Database, aid: number): AnimeRow | undefined {
	return db.prepare('SELECT * FROM anime WHERE aid = ?').get(aid) as AnimeRow | undefined;
}

export function setDescription(db: BetterSqlite3.Database, aid: number, description: string): void {
	db.prepare(
		'UPDATE anime SET description = ?, desc_fetched_at = unixepoch(), updated_at = unixepoch() WHERE aid = ?'
	).run(description, aid);
}
