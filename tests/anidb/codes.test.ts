import { describe, it, expect } from 'vitest';
import { parseHeader, REPLY } from '../../src/lib/server/anidb/codes';

describe('parseHeader', () => {
	it('parses code-only header', () => {
		const r = parseHeader(Buffer.from('200 LOGIN ACCEPTED s=abcd\n'));
		expect(r.code).toBe(200);
	});
	it('parses tagged header', () => {
		const r = parseHeader(Buffer.from('mytag 297 CALENDAR\n100|1700000000|0\n'));
		expect(r.tag).toBe('mytag');
		expect(r.code).toBe(297);
		expect(r.rest).toContain('100|1700000000|0');
	});
});

describe('REPLY codes', () => {
	it('exposes UPDATED and NO_UPDATES reply codes', () => {
		expect(REPLY.UPDATED).toBe(243);
		expect(REPLY.NO_UPDATES).toBe(343);
	});
});
