import type BetterSqlite3 from 'better-sqlite3';
import { byAid as animeByAid, type AnimeRow } from '../repositories/anime';
import { byAid as mylistByAid, type MylistRow } from '../repositories/mylist';

export interface AnimeDetail {
	anime: AnimeRow;
	titles: { lang: string; type: string; title: string }[];
	tags: { tag_name: string; weight: number | null }[];
	relations: { related_aid: number; type: string | null }[];
	characters: {
		char_id: number;
		appearance: number | null;
		name_translit: string | null;
		pic: string | null;
	}[];
	mylist: MylistRow | null;
}

export function getDetail(db: BetterSqlite3.Database, aid: number): AnimeDetail | null {
	const anime = animeByAid(db, aid);
	if (!anime || anime.fetched_at === null) return null;
	// Order: type priority (main → synonym → short → other → anything else),
	// then lang ASC, then title ASC. Title ASC is the stable-display tiebreaker
	// so re-fetches don't reshuffle within a (type, lang) bucket.
	const titles = db
		.prepare(
			`SELECT lang, type, title
			 FROM anime_title
			 WHERE aid = ?
			 ORDER BY
			   CASE type
			     WHEN 'main' THEN 1
			     WHEN 'synonym' THEN 2
			     WHEN 'short' THEN 3
			     WHEN 'other' THEN 4
			     ELSE 5
			   END,
			   lang ASC,
			   title ASC`
		)
		.all(aid) as AnimeDetail['titles'];
	const tags = db
		.prepare('SELECT tag_name, weight FROM anime_tag WHERE aid = ? ORDER BY weight DESC NULLS LAST')
		.all(aid) as AnimeDetail['tags'];
	const relations = db
		.prepare('SELECT related_aid, type FROM anime_relation WHERE aid = ?')
		.all(aid) as AnimeDetail['relations'];
	const characters = db
		.prepare(
			`
    SELECT ac.char_id, ac.appearance, c.name_translit, c.pic
    FROM anime_character ac
    LEFT JOIN character c ON c.char_id = ac.char_id
    WHERE ac.aid = ?
    ORDER BY ac.appearance ASC
  `
		)
		.all(aid) as AnimeDetail['characters'];
	const mylist = mylistByAid(db, aid) ?? null;
	return { anime, titles, tags, relations, characters, mylist };
}
