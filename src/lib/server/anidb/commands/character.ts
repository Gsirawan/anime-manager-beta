import type { Session } from '../session';
import { parseHeader, REPLY } from '../codes';

export interface CharacterResult {
	char_id: number;
	name_kanji: string | null;
	name_translit: string | null;
	pic: string | null;
	gender: string | null;
	type: number | null;
}

export async function fetchCharacter(
	session: Session,
	charId: number
): Promise<CharacterResult | null> {
	const reply = await session.sendWithSession(`CHARACTER charid=${charId}`);
	const h = parseHeader(reply);
	if (h.code === REPLY.NO_SUCH_CHARACTER) return null;
	if (h.code !== REPLY.CHARACTER) throw new Error(`CHARACTER failed: ${h.code} ${h.rest}`);
	const body = reply.toString().split('\n')[1] ?? '';
	// Fields: charid|name_kanji|name_translit|pic|anime_blocks|episode_list|last_update|type|gender
	const parts = body.split('|');
	return {
		char_id: Number(parts[0]),
		name_kanji: parts[1] || null,
		name_translit: parts[2] || null,
		pic: parts[3] || null,
		type: parts[7] ? Number(parts[7]) : null,
		gender: parts[8]?.trim() || null
	};
}
