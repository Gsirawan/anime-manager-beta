// AniDB UDP ANIME amask: 7 bytes, bit 7 is MSB of each byte.
// Field order follows the UDP API definition.
export const AMASK_FIELDS = [
	// byte 1
	'aid',
	'dateflags',
	'year',
	'type',
	'related_aid_list',
	'related_aid_type',
	'category_list',
	'reserved_1_0',
	// byte 2
	'romaji_name',
	'kanji_name',
	'english_name',
	'other_names',
	'short_name_list',
	'synonym_list',
	'reserved_2_1',
	'reserved_2_0',
	// byte 3
	'episodes',
	'highest_episode_number',
	'special_ep_count',
	'air_date',
	'end_date',
	'url',
	'picname',
	'category_id_list',
	// byte 4
	'rating',
	'vote_count',
	'temp_rating',
	'temp_vote_count',
	'average_review_rating',
	'review_count',
	'award_list',
	'is_18_restricted',
	// byte 5
	// Bit 7 is retired per AniDB spec. Earlier versions of this file mis-labelled
	// bit 7 as ann_id, which shifted ann_id/allcinema_id/animenfo_id/tag_name_list/
	// tag_id_list/tag_weight_list/date_record_updated up by one bit. The result: a
	// request for tag_name_list actually set the animenfo_id bit, so the server
	// returned animenfo_id where tag_name_list was expected and the decoder
	// labelled the slot tag_name_list anyway — every tag persisted as garbage
	// (NaN tag id → loop skip → zero tags per anime).
	'reserved_5_7',
	'ann_id',
	'allcinema_id',
	'animenfo_id',
	'tag_name_list',
	'tag_id_list',
	'tag_weight_list',
	'date_record_updated',
	// byte 6
	// Only bit 7 (character_id_list) is defined. Bits 6..4 are retired and
	// bits 3..0 are unused per spec. Requesting any "unused" bit triggers a
	// 505 illegal-input from AniDB. Earlier versions of this file mis-labelled
	// bits 6..0 as creator_id_list/producer_*/specials_count/credits_count/
	// other_count/trailer_count — none were referenced by DEFAULT_FIELDS so
	// the bug was dormant, but a future request would have tripped 505.
	'character_id_list',
	'reserved_6_6',
	'reserved_6_5',
	'reserved_6_4',
	'reserved_6_3',
	'reserved_6_2',
	'reserved_6_1',
	'reserved_6_0',
	// byte 7
	// Bits 7..3 are episode-count fields. Bits 2..0 are unused per spec.
	// Earlier versions parked parody_count alone in bit 7 and labelled the
	// rest reserved — same class of dormant landmine as byte 6.
	'specials_count',
	'credits_count',
	'other_count',
	'trailer_count',
	'parody_count',
	'reserved_7_2',
	'reserved_7_1',
	'reserved_7_0'
] as const;
export type AmaskField = (typeof AMASK_FIELDS)[number];

export function buildAmask(fields: AmaskField[]): string {
	const bytes = [0, 0, 0, 0, 0, 0, 0];
	for (const f of fields) {
		const idx = AMASK_FIELDS.indexOf(f);
		if (idx < 0) throw new Error(`unknown amask field: ${f}`);
		const byte = Math.floor(idx / 8);
		const bit = 7 - (idx % 8);
		bytes[byte] |= 1 << bit;
	}
	return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

const NUMERIC_FIELDS = new Set<AmaskField>([
	'aid',
	'dateflags',
	// 'year' is "str year" per docs line 877 — NOT numeric. AniDB returns
	// ranges like "1999-1999" or "2024-2025" which Number() coerces to NaN,
	// breaking parseYear() in animeFetch.ts. Discovered 2026-05-16 via the
	// integration test against fake-anidb-server.mjs.
	'episodes',
	'highest_episode_number',
	'special_ep_count',
	'air_date',
	'end_date',
	'vote_count',
	'temp_vote_count',
	'review_count',
	'is_18_restricted',
	'date_record_updated',
	'specials_count',
	'credits_count',
	'other_count',
	'trailer_count',
	'parody_count'
]);
const FLOAT_FIELDS = new Set<AmaskField>(['rating', 'temp_rating', 'average_review_rating']);

export function decodeAnime(
	reply: string,
	fields: AmaskField[]
): Record<string, string | number | null> {
	const parts = reply.split('|');
	const out: Record<string, string | number | null> = {};
	for (let i = 0; i < fields.length; i++) {
		const f = fields[i];
		const raw = parts[i] ?? '';
		if (raw === '') {
			out[f] = null;
			continue;
		}
		if (FLOAT_FIELDS.has(f)) out[f] = Number(raw) / 100;
		else if (NUMERIC_FIELDS.has(f)) out[f] = Number(raw);
		else out[f] = raw;
	}
	return out;
}
