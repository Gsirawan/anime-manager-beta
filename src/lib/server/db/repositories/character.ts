import type BetterSqlite3 from 'better-sqlite3';

export interface CharacterRow {
	char_id: number;
	name_kanji: string | null;
	name_translit: string | null;
	pic: string | null;
	gender: string | null;
	type: number | null;
	fetched_at: number | null;
}

export function upsert(db: BetterSqlite3.Database, row: CharacterRow): void {
	db.prepare(
		`
    INSERT INTO character (char_id, name_kanji, name_translit, pic, gender, type, fetched_at)
    VALUES (@char_id, @name_kanji, @name_translit, @pic, @gender, @type, @fetched_at)
    ON CONFLICT(char_id) DO UPDATE SET
      name_kanji = excluded.name_kanji,
      name_translit = excluded.name_translit,
      pic = excluded.pic,
      gender = excluded.gender,
      type = excluded.type,
      fetched_at = excluded.fetched_at
  `
	).run(row);
}

export function byId(db: BetterSqlite3.Database, charId: number): CharacterRow | undefined {
	return db.prepare('SELECT * FROM character WHERE char_id = ?').get(charId) as
		| CharacterRow
		| undefined;
}
