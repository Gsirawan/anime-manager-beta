import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { fetchCharacter } from '../../../src/lib/server/anidb/commands/character';

describe('fetchCharacter', () => {
	it('parses CHARACTER reply', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('235 CHARACTER\n42|ホロ|Holo|holo.jpg|1,2,,|undefined|1700000000|1|female\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		const c = await fetchCharacter(s, 42);
		expect(c).toMatchObject({
			char_id: 42,
			name_kanji: 'ホロ',
			name_translit: 'Holo',
			pic: 'holo.jpg',
			type: 1,
			gender: 'female'
		});
	});

	it('returns null on NO_SUCH_CHARACTER', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('350 NO SUCH CHARACTER\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		expect(await fetchCharacter(s, 999)).toBeNull();
	});
});
