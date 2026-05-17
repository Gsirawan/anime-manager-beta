import { describe, it, expect } from 'vitest';
import { AMASK_FIELDS, buildAmask, decodeAnime } from '../../src/lib/server/anidb/amask';

describe('amask codec', () => {
	it('builds amask bytes for selected fields', () => {
		// first byte bit 7 = aid; bit 5 = year; both set = 0b10100000 = 0xA0
		const mask = buildAmask(['aid', 'year']);
		expect(mask).toBe('A0000000000000');
	});

	it('decodes a reply matching the selected fields, in field order', () => {
		const fields = ['aid', 'year', 'type', 'romaji_name'] as const;
		const reply = '1|2026|TV Series|Spice and Wolf';
		const decoded = decodeAnime(reply, [...fields]);
		expect(decoded).toEqual({
			aid: 1,
			// year is "str year" per docs line 877 — stays as string in the
			// decoded record. animeFetch's parseYear() extracts the leading
			// 4 digits for the anime.year column.
			year: '2026',
			type: 'TV Series',
			romaji_name: 'Spice and Wolf'
		});
	});

	it('returns the canonical field order', () => {
		// sanity: AMASK_FIELDS array spans 7 bytes * 8 bits = 56 entries
		expect(AMASK_FIELDS.length).toBe(56);
		expect(AMASK_FIELDS.slice(0, 8)).toEqual([
			'aid',
			'dateflags',
			'year',
			'type',
			'related_aid_list',
			'related_aid_type',
			'category_list',
			'reserved_1_0'
		]);
	});

	// Byte 5 alignment regression — these three bits MUST resolve to byte 5
	// bits 3+2+1 (= 0x0E). Previously the labels were shifted up by one bit,
	// causing buildAmask to request animenfo_id/tag_name_list/tag_id_list
	// while the decoder labelled them tag_name_list/tag_id_list/tag_weight_list,
	// which made tag persistence silently drop every row (NaN tag id).
	it('byte 5: tag bits land on bits 3+2+1 → 0x0E', () => {
		const mask = buildAmask(['tag_name_list', 'tag_id_list', 'tag_weight_list']);
		// 7 bytes → 14 hex chars. Byte 5 is chars [8..10) (0-indexed bytes 0..6).
		expect(mask.length).toBe(14);
		expect(mask.slice(8, 10)).toBe('0E');
	});

	// Byte 6 alignment regression — character_id_list MUST land at byte 6 bit 7
	// (= 0x80). All other byte 6 bits per spec are retired/unused.
	it('byte 6: character_id_list lands on bit 7 → 0x80', () => {
		const mask = buildAmask(['character_id_list']);
		expect(mask.slice(10, 12)).toBe('80');
	});

	// Byte 7 alignment regression — when (or if) the worker requests episode
	// counts (specials/credits/other/trailer/parody), they MUST occupy
	// byte 7 bits 7..3 (= 0xF8). Today none of these are in DEFAULT_FIELDS
	// but the label table must stay correct so a future request doesn't
	// trigger a 505 illegal-input ban.
	it('byte 7: episode-count bits land on bits 7..3 → 0xF8', () => {
		const mask = buildAmask([
			'specials_count',
			'credits_count',
			'other_count',
			'trailer_count',
			'parody_count'
		]);
		expect(mask.slice(12, 14)).toBe('F8');
	});
});
