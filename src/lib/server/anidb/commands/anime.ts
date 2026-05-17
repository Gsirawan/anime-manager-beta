import type { Session } from '../session';
import { parseHeader, REPLY } from '../codes';
import { buildAmask, decodeAnime, type AmaskField } from '../amask';

// Field set we always request — matches what we persist in the anime + title
// + tag + relation + character link tables.
//
// Title languages: we fetch ALL variants AniDB exposes (romaji, kanji, english,
// other, short, synonym) and store them under their declared lang/type in
// anime_title. The JP-origin filter is enforced AFTER the fetch via the origin
// tag classifier (see src/lib/server/anidb/originTags.ts), not by withholding
// title-language fields here.
export const DEFAULT_FIELDS: AmaskField[] = [
	// byte 1
	'aid',
	'year',
	'type',
	'related_aid_list',
	'related_aid_type',
	// byte 2 — all title languages
	'romaji_name',
	'kanji_name',
	'english_name',
	'other_names',
	'short_name_list',
	'synonym_list',
	// byte 3
	'episodes',
	'air_date',
	'end_date',
	'picname',
	// byte 4
	'rating',
	'vote_count',
	'is_18_restricted',
	// byte 5
	'tag_name_list',
	'tag_id_list',
	'tag_weight_list',
	// byte 6
	'character_id_list'
];

export async function fetchAnime(
	session: Session,
	aid: number,
	fields: AmaskField[] = DEFAULT_FIELDS
): Promise<Record<string, string | number | null> | null> {
	const amask = buildAmask(fields);
	const cmd = `ANIME aid=${aid}&amask=${amask}`;
	const reply = await session.sendWithSession(cmd);
	const h = parseHeader(reply);
	if (h.code === REPLY.NO_SUCH_ANIME) return null;
	if (h.code !== REPLY.ANIME) throw new Error(`ANIME failed: ${h.code} ${h.rest}`);
	// body is one line after the header
	const body = reply.toString().split('\n')[1] ?? '';
	return decodeAnime(body, fields);
}
