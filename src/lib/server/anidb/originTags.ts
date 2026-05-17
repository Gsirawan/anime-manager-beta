// Source of truth for AniDB origin-tag classification.
//
// Match is case-insensitive exact-name (after trim) against the names returned
// in the ANIME response's tag_name_list. To extend coverage, add an entry. To
// change policy on an existing origin, flip the verdict.
//
// The full live list should be finalized post-deploy via:
//   SELECT DISTINCT tag_name FROM anime_tag
//   WHERE tag_name LIKE '% production' ORDER BY tag_name;
// against the mini-PC DB. Entries below are the seed set.
export const ORIGIN_TAGS: Record<string, 'keep' | 'tombstone'> = {
	'japanese production': 'keep',
	'korean production': 'tombstone',
	'chinese production': 'tombstone',
	'american production': 'tombstone',
	'french production': 'tombstone',
	'russian production': 'tombstone',
	'taiwanese production': 'tombstone',
	'thai production': 'tombstone',
	'indian production': 'tombstone',
	'filipino production': 'tombstone',
	'brazilian production': 'tombstone'
};

/**
 * Permissive origin classifier:
 *   - any Japan-origin tag (incl. co-prod variants we add later) → 'keep'
 *   - any non-Japan origin tag with NO Japan match               → 'tombstone'
 *   - no known origin tag at all                                 → 'keep'
 *
 * The "untagged → keep" rule covers both genuinely untagged anime AND
 * the UDP packet-truncation edge case (origin tag falling off the end).
 */
export function classifyOrigin(tagNames: string[]): 'keep' | 'tombstone' {
	let sawJapan = false;
	let sawNonJapan = false;
	for (const raw of tagNames) {
		const name = raw.trim().toLowerCase();
		const verdict = ORIGIN_TAGS[name];
		if (verdict === 'keep') sawJapan = true;
		else if (verdict === 'tombstone') sawNonJapan = true;
	}
	if (sawJapan) return 'keep';
	if (sawNonJapan) return 'tombstone';
	return 'keep';
}
