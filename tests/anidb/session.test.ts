import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../src/lib/server/anidb/transport';
import { Session } from '../../src/lib/server/anidb/session';

// AniDB UDP AUTH response format (per https://wiki.anidb.net/UDP_API_Definition#AUTH):
//   200 {str session_key} LOGIN ACCEPTED
//   201 {str session_key} LOGIN ACCEPTED - NEW VERSION AVAILABLE
// Session key is the SECOND whitespace-separated token (immediately after the code).

describe('Session', () => {
	it('logs in and stores session key from the correct position', async () => {
		const t = new FakeTransport([Buffer.from('200 sKey1 LOGIN ACCEPTED\n')]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await s.ensure();
		expect(s.key).toBe('sKey1');
		expect(t.sent[0].toString()).toContain('AUTH user=u');
	});

	it('handles 201 LOGIN ACCEPTED - NEW VERSION AVAILABLE', async () => {
		const t = new FakeTransport([
			Buffer.from('201 sKey9 LOGIN ACCEPTED - NEW VERSION AVAILABLE\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await s.ensure();
		expect(s.key).toBe('sKey9');
	});

	it('re-authenticates on INVALID_SESSION and retries the original command', async () => {
		const t = new FakeTransport([
			Buffer.from('200 sKey1 LOGIN ACCEPTED\n'),
			Buffer.from('506 INVALID SESSION\n'),
			Buffer.from('200 sKey2 LOGIN ACCEPTED\n'),
			Buffer.from('297 CALENDAR\n1|1234567890|0\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await s.ensure();
		const r = await s.sendWithSession('CALENDAR');
		expect(r.toString()).toContain('297 CALENDAR');
		expect(s.key).toBe('sKey2');
	});

	it('re-authenticates on LOGIN_FIRST (501) and retries the original command', async () => {
		// Per AniDB UDP spec: on 501 LOGIN FIRST the client should silently
		// resend AUTH and the failed command. This is the recovery path the
		// mylist composite-key edit hit live (aid=17305) when the session
		// expired mid-call. Without this retry, the edit fails permanently.
		const t = new FakeTransport([
			Buffer.from('200 sKey1 LOGIN ACCEPTED\n'),
			Buffer.from('501 LOGIN FIRST\n'),
			Buffer.from('200 sKey2 LOGIN ACCEPTED\n'),
			Buffer.from('311 MYLIST ENTRY EDITED\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await s.ensure();
		const r = await s.sendWithSession('MYLISTADD aid=17305&generic=1&epno=1&edit=1&state=1&viewed=0');
		expect(r.toString()).toContain('311 MYLIST ENTRY EDITED');
		expect(s.key).toBe('sKey2');
	});

	it('logout clears the key', async () => {
		const t = new FakeTransport([
			Buffer.from('200 sKey1 LOGIN ACCEPTED\n'),
			Buffer.from('203 LOGGED OUT\n')
		]);
		const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
		await s.ensure();
		await s.logout();
		expect(s.key).toBeNull();
	});
});
