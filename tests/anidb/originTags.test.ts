import { describe, it, expect } from 'vitest';
import { classifyOrigin } from '../../src/lib/server/anidb/originTags';

describe('classifyOrigin', () => {
	it('returns keep for empty tag list (untagged → permissive)', () => {
		expect(classifyOrigin([])).toBe('keep');
	});

	it('returns keep when only a Japan-origin tag is present', () => {
		expect(classifyOrigin(['Japanese production'])).toBe('keep');
	});

	it('returns tombstone when only a non-Japan origin tag is present', () => {
		expect(classifyOrigin(['Korean production'])).toBe('tombstone');
	});

	it('returns keep when Japan-origin and non-Japan origin both present (Japan wins)', () => {
		expect(classifyOrigin(['Japanese production', 'Korean production'])).toBe('keep');
	});

	it('matches origin tag names case-insensitively', () => {
		expect(classifyOrigin(['JAPANESE PRODUCTION'])).toBe('keep');
		expect(classifyOrigin(['korean PRODUCTION'])).toBe('tombstone');
	});

	it('returns keep when no origin tag matches (only genre/theme tags)', () => {
		expect(classifyOrigin(['Action', 'Comedy', 'Romance', 'Setting: Japan'])).toBe('keep');
	});

	it('ignores leading/trailing whitespace on tag names', () => {
		expect(classifyOrigin(['  Japanese production  '])).toBe('keep');
	});
});
