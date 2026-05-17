import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { fetchAnime, DEFAULT_FIELDS } from '../../../src/lib/server/anidb/commands/anime';

describe('fetchAnime', () => {
	it('builds ANIME request and returns decoded fields (new DEFAULT_FIELDS order)', async () => {
		// Reply body must list fields in DEFAULT_FIELDS order:
		// aid, year, type, related_aid_list, related_aid_type,
		// romaji_name, kanji_name, english_name, other_names, short_name_list, synonym_list,
		// episodes, air_date, end_date, picname,
		// rating, vote_count, is_18_restricted,
		// tag_name_list, tag_id_list, tag_weight_list,
		// character_id_list
		// List separator is COMMA on the wire (see animeFetch.test.ts notes
		// + scripts/probe-anime.mjs output from 2026-05-16).
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from(
				'230 ANIME\n1|2026|TV Series|2,3|1,2|Spice and Wolf|狼と香辛料|Spice and Wolf|Holo no Bouken|S&W|Ookami to Koushinryou|12|1700000000|1707000000|holo.jpg|840|1200|0|Adventure,Romance|100,200|7,8|400,401\n'
			)
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		const result = await fetchAnime(s, 1);
		expect(result?.aid).toBe(1);
		// year is "str year" per docs line 877 — NOT numeric. Decoder leaves
		// it as a string; animeFetch.ts/parseYear extracts the leading 4 digits
		// for the anime.year column.
		expect(result?.year).toBe('2026');
		expect(result?.type).toBe('TV Series');
		expect(result?.episodes).toBe(12);
		expect(result?.picname).toBe('holo.jpg');
		expect(result?.rating).toBeCloseTo(8.4);
		expect(result?.romaji_name).toBe('Spice and Wolf');
		expect(result?.kanji_name).toBe('狼と香辛料');
		expect(result?.english_name).toBe('Spice and Wolf');
		expect(result?.other_names).toBe('Holo no Bouken');
		expect(result?.is_18_restricted).toBe(0);
	});

	it('returns null on NO_SUCH_ANIME', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('330 NO SUCH ANIME\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		expect(await fetchAnime(s, 99999999)).toBeNull();
	});
});

describe('DEFAULT_FIELDS for the refactor', () => {
	it('includes ALL title language variants (post JP-origin filter rework)', () => {
		// Title-language whitelist moved out of the amask. JP-origin filtering
		// now happens post-fetch via the origin tag classifier.
		for (const f of [
			'romaji_name',
			'kanji_name',
			'english_name',
			'other_names',
			'short_name_list',
			'synonym_list'
		] as const) {
			expect(DEFAULT_FIELDS).toContain(f);
		}
	});
	it('includes tags, relations, characters, restricted, picname', () => {
		for (const f of [
			'related_aid_list',
			'related_aid_type',
			'tag_id_list',
			'tag_name_list',
			'tag_weight_list',
			'character_id_list',
			'is_18_restricted',
			'picname'
		] as const) {
			expect(DEFAULT_FIELDS).toContain(f);
		}
	});
});
