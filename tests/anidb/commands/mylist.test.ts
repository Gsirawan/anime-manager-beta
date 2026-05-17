import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import {
	mylistAddAnime,
	mylistEditGeneric
} from '../../../src/lib/server/anidb/commands/mylist';

describe('mylist commands', () => {
	it('mylistAddAnime returns added=true on 210 — does NOT trust the body for a lid', async () => {
		// AniDB returns an entry-count in the body for animeinfo adds (here "1"),
		// which previously got mis-parsed as lid=1. Make sure we no longer leak it.
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('210 MYLIST ENTRY ADDED\n1\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		const r = await mylistAddAnime(s, 1, { state: 1, viewed: 0 });
		expect(r.added).toBe(true);
		expect(r).not.toHaveProperty('lid');
	});

	it('mylistAddAnime auto-resends with edit=1 on 310 ALREADY_IN_MYLIST', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('310 FILE ALREADY IN MYLIST\n9876|111|state|viewed\n'),
			Buffer.from('311 MYLIST ENTRY EDITED\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		const r = await mylistAddAnime(s, 1, { state: 1, viewed: 0 });
		expect(r.edited).toBe(true);
	});

	it('mylistAddAnime sends generic=1&epno=1 (the correct shape per AniDB UDP spec)', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('210 MYLIST ENTRY ADDED\n1\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await mylistAddAnime(s, 19242, { state: 1, viewed: 0 });
		const sent = (t as unknown as { sent: Buffer[] }).sent;
		const cmd = sent[sent.length - 1].toString();
		expect(cmd).toContain('MYLISTADD');
		expect(cmd).toContain('aid=19242');
		expect(cmd).toContain('generic=1');
		expect(cmd).toContain('epno=1');
		expect(cmd).toContain('state=1');
	});

	it('mylistAddAnime throws on 505 ILLEGAL_INPUT', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('505 ILLEGAL INPUT OR ACCESS DENIED\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await expect(mylistAddAnime(s, 1, { state: 1, viewed: 0 })).rejects.toThrow(/505/);
	});

	it('mylistEditGeneric issues MYLISTADD aid=X&generic=1&epno=1&edit=1', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('311 MYLIST ENTRY EDITED\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await mylistEditGeneric(s, 19139, { state: 1, viewed: 1 });
		const sent = (t as unknown as { sent: Buffer[] }).sent;
		const cmd = sent[sent.length - 1].toString();
		expect(cmd).toContain('MYLISTADD aid=19139');
		expect(cmd).toContain('generic=1');
		expect(cmd).toContain('epno=1');
		expect(cmd).toContain('edit=1');
		expect(cmd).toContain('state=1');
		expect(cmd).toContain('viewed=1');
	});

	it('mylistEditGeneric throws on 411 NO SUCH MYLIST ENTRY', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED sKey\n'),
			Buffer.from('411 NO SUCH MYLIST ENTRY\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await expect(mylistEditGeneric(s, 1, { state: 1 })).rejects.toThrow(/411/);
	});
});
