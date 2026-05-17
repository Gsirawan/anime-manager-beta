import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../../src/lib/server/anidb/transport';

describe('FakeTransport', () => {
	it('returns canned responses in order', async () => {
		const t = new FakeTransport([
			Buffer.from('200 LOGIN ACCEPTED s=abc'),
			Buffer.from('230 LOGOUT')
		]);
		expect((await t.send(Buffer.from('AUTH user=x'))).toString()).toContain('200 LOGIN ACCEPTED');
		expect((await t.send(Buffer.from('LOGOUT s=abc'))).toString()).toContain('230 LOGOUT');
	});
	it('records sent packets', async () => {
		const t = new FakeTransport([Buffer.from('200 OK')]);
		await t.send(Buffer.from('PING'));
		expect(t.sent.map((b) => b.toString())).toEqual(['PING']);
	});
});
