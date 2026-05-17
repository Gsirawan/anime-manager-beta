import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { fetchAnimeDesc } from '../../../src/lib/server/anidb/commands/animeDesc';

describe('fetchAnimeDesc', () => {
	it('concatenates paginated description', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('233 ANIME DESCRIPTION\n0|2|First half. '),
			Buffer.from('233 ANIME DESCRIPTION\n1|2|Second half.')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		const desc = await fetchAnimeDesc(s, 1);
		expect(desc).toBe('First half. Second half.');
	});

	it('returns null on NO_DATA', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('312 NO DATA\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		expect(await fetchAnimeDesc(s, 1)).toBeNull();
	});
});
