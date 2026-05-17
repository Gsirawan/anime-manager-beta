import { describe, it, expect } from 'vitest';
import { parseJobParams } from '../../src/lib/server/jobs/kinds';

describe('parseJobParams', () => {
	it('validates anime_fetch params', () => {
		expect(parseJobParams('anime_fetch', { aid: 1 })).toEqual({ aid: 1 });
	});
	it('rejects bad anime_fetch params', () => {
		expect(() => parseJobParams('anime_fetch', {})).toThrow();
	});
	it('accepts empty params for updated_sync', () => {
		expect(parseJobParams('updated_sync', {})).toEqual({});
	});
	it('validates mylist_add params', () => {
		expect(parseJobParams('mylist_add', { aid: 1, state: 1, viewed: 0 })).toMatchObject({
			aid: 1,
			state: 1,
			viewed: 0
		});
	});
});
