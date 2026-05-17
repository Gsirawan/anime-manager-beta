import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { fetchUpdated } from '../../../src/lib/server/anidb/commands/updated';

function mkSession(replies: string[]) {
	const t = new FakeTransport(replies.map((r) => Buffer.from(r)));
	const s = new Session(t, { user: 'u', pass: 'p', client: 'c', clientver: 1 });
	// skip AUTH for the test
	s.key = 'TESTKEY';
	return { t, s };
}

describe('fetchUpdated', () => {
	it('parses a 243 UPDATED reply into an aid list', async () => {
		const { s } = mkSession(['243 UPDATED\n1|3|1700000000|100,200,300\n']);
		const res = await fetchUpdated(s, 3);
		expect(res.aids).toEqual([100, 200, 300]);
		expect(res.totalCount).toBe(3);
		expect(res.lastUpdate).toBe(1700000000);
	});

	it('returns empty list for 343 NO UPDATES', async () => {
		const { s } = mkSession(['343 NO UPDATES\n']);
		const res = await fetchUpdated(s, 3);
		expect(res.aids).toEqual([]);
		expect(res.totalCount).toBe(0);
	});

	it('throws on 555 BANNED', async () => {
		const { s } = mkSession(['555 BANNED\n']);
		await expect(fetchUpdated(s, 3)).rejects.toThrow(/555|BANNED/i);
	});
});
