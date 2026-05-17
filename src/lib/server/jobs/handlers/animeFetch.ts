import { fetchAnime, DEFAULT_FIELDS } from '../../anidb/commands/anime';
import { classifyOrigin } from '../../anidb/originTags';
import { upsert as upsertAnime } from '../../db/repositories/anime';
import { setMeta } from '../../db/repositories/meta';
import { enqueue } from '../../db/repositories/jobs';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

/**
 * Fetch full anime metadata via UDP ANIME.
 *
 * Pre-flight gate (in the worker) has already approved the send.
 * This handler:
 *   1. Writes last_attempt_at = now BEFORE sending (so a ban can't bypass
 *      the 14-day TTL on the next attempt).
 *   2. Sends UDP ANIME aid=X&amask=<DEFAULT_FIELDS>.
 *   3. On 330 → tombstone 'no_such_anime'.
 *   4. On 230 → persist anime + JP-only titles + tags + relations + char ids,
 *               enqueue follow-up anime_desc_fetch.
 *   5. Errors bubble; the worker catches 555 / 504 / BANNED.
 */
export async function animeFetch(
	params: JobParamsOf<'anime_fetch'>,
	ctx: WorkerContext
): Promise<void> {
	const nowSec = Math.floor(Date.now() / 1000);

	// 1 — Write last_attempt_at FIRST, before the UDP packet leaves.
	ctx.db
		.prepare(
			`INSERT INTO anime (aid, last_attempt_at) VALUES (?, ?)
       ON CONFLICT(aid) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`
		)
		.run(params.aid, nowSec);

	// 2 — Send the UDP ANIME command. fetchAnime returns:
	//       - the decoded record on 230
	//       - null on 330 NO SUCH ANIME
	//       - throws otherwise (including 555)
	const decoded = await fetchAnime(ctx.session, params.aid, DEFAULT_FIELDS);

	if (decoded === null) {
		setMeta(ctx.db, `tombstone_anime_${params.aid}`, `no_such_anime|${nowSec}`);
		return;
	}

	// 3 — Persist. Use a transaction so a mid-write crash leaves consistent state.
	//
	// Date sentinel handling: AniDB encodes "unknown date" as integer 0 (per
	// the UDP spec's dateflags convention). Storing the literal 0 corrupts
	// downstream code that treats start_date / end_date as real timestamps —
	// most visibly, year-derivation maps 0 to 1970 (unix epoch). Coerce both
	// fields to NULL when AniDB sends 0. The deriveYear helper already
	// guards with > 0, but normalising at persist time means every other
	// consumer (sort cutoffs, season filter, info-tab "Aired" range) also
	// sees clean nullable dates.
	const airDateRaw = (decoded.air_date as number | null) ?? null;
	const endDateRaw = (decoded.end_date as number | null) ?? null;
	const startDate =
		typeof airDateRaw === 'number' && airDateRaw > 0 ? airDateRaw : null;
	const endDate =
		typeof endDateRaw === 'number' && endDateRaw > 0 ? endDateRaw : null;
	const tx = ctx.db.transaction(() => {
		upsertAnime(ctx.db, {
			aid: params.aid,
			type: (decoded.type as string | null) ?? null,
			episode_count: (decoded.episodes as number | null) ?? null,
			start_date: startDate,
			end_date: endDate,
			year: deriveYear(decoded.year as string | number | null, startDate, endDate),
			picname: (decoded.picname as string | null) ?? null,
			rating: (decoded.rating as number | null) ?? null,
			vote_count: (decoded.vote_count as number | null) ?? null,
			restricted: Number(decoded.is_18_restricted ?? 0),
			fetched_at: nowSec
		});

		// Titles — all language variants AniDB returned.
		//
		//   romaji_name      → (x-jat, main)    — single string
		//   kanji_name       → (ja, main)       — single string
		//   english_name     → (en, main)       — single string
		//   other_names      → (en, other)      — single string per spec ("str
		//                                         other name") but our schema
		//                                         allows multi; either separator
		//                                         is safe.
		//   short_name_list  → (x-jat, short)   — APOSTROPHE-separated list
		//                                         (docs/udp-docs.md line 857)
		//   synonym_list     → (en, synonym)    — APOSTROPHE-separated list
		//                                         (docs/udp-docs.md line 857)
		//
		// JP-origin filtering happens AFTER persistence via classifyOrigin().
		ctx.db.prepare(`DELETE FROM anime_title WHERE aid = ?`).run(params.aid);
		const insTitle = ctx.db.prepare(
			`INSERT OR IGNORE INTO anime_title (aid, lang, type, title) VALUES (?, ?, ?, ?)`
		);
		const romaji = (decoded.romaji_name as string | null) ?? null;
		const kanji = (decoded.kanji_name as string | null) ?? null;
		const english = (decoded.english_name as string | null) ?? null;
		if (romaji) insTitle.run(params.aid, 'x-jat', 'main', romaji);
		if (kanji) insTitle.run(params.aid, 'ja', 'main', kanji);
		if (english) insTitle.run(params.aid, 'en', 'main', english);
		// other_names is singular per spec but we tolerate either separator.
		for (const t of splitAposList(decoded.other_names as string | null)) {
			insTitle.run(params.aid, 'en', 'other', t);
		}
		for (const t of splitAposList(decoded.short_name_list as string | null)) {
			insTitle.run(params.aid, 'x-jat', 'short', t);
		}
		for (const t of splitAposList(decoded.synonym_list as string | null)) {
			insTitle.run(params.aid, 'en', 'synonym', t);
		}

		// Tags — three parallel lists (id, name, weight) joined by "'".
		ctx.db.prepare(`DELETE FROM anime_tag WHERE aid = ?`).run(params.aid);
		const tagIds = splitList(decoded.tag_id_list as string | null);
		const tagNames = splitList(decoded.tag_name_list as string | null);
		const tagWeights = splitList(decoded.tag_weight_list as string | null);
		const insTag = ctx.db.prepare(
			`INSERT OR IGNORE INTO anime_tag (aid, tag_id, tag_name, weight) VALUES (?, ?, ?, ?)`
		);
		for (let i = 0; i < tagIds.length; i++) {
			const id = Number(tagIds[i]);
			if (!Number.isFinite(id)) continue;
			insTag.run(params.aid, id, tagNames[i] ?? '', Number(tagWeights[i] ?? 0));
		}

		// Relations — related_aid_list parallel to related_aid_type.
		ctx.db.prepare(`DELETE FROM anime_relation WHERE aid = ?`).run(params.aid);
		const relAids = splitList(decoded.related_aid_list as string | null);
		const relTypes = splitList(decoded.related_aid_type as string | null);
		const insRel = ctx.db.prepare(
			`INSERT OR IGNORE INTO anime_relation (aid, related_aid, type) VALUES (?, ?, ?)`
		);
		for (let i = 0; i < relAids.length; i++) {
			const rel = Number(relAids[i]);
			if (!Number.isFinite(rel)) continue;
			insRel.run(params.aid, rel, relTypes[i] ?? '');
		}

		// Character IDs — link table only. The character row itself is filled by
		// a separate (deferred) character_fetch path.
		ctx.db.prepare(`DELETE FROM anime_character WHERE aid = ?`).run(params.aid);
		const charIds = splitList(decoded.character_id_list as string | null);
		const insChar = ctx.db.prepare(
			`INSERT OR IGNORE INTO anime_character (aid, char_id, appearance) VALUES (?, ?, 0)`
		);
		for (const c of charIds) {
			const cid = Number(c);
			if (Number.isFinite(cid) && cid > 0) insChar.run(params.aid, cid);
		}
	});
	tx();

	// 3a — Post-fetch origin classification. The classifier is permissive
	// (untagged → keep), so this only tombstones aids with a definite
	// non-Japan origin tag. See src/lib/server/anidb/originTags.ts.
	const tagNames = splitList(decoded.tag_name_list as string | null);
	if (classifyOrigin(tagNames) === 'tombstone') {
		setMeta(ctx.db, `tombstone_anime_${params.aid}`, `non_japanese|${nowSec}`);
		// Do NOT enqueue anime_desc_fetch for tombstoned aids — return early.
		return;
	}

	// 4 — Enqueue follow-up description fetch. Gate will check 14d TTL.
	enqueue(ctx.db, { kind: 'anime_desc_fetch', params: { aid: params.aid }, priority: 25 });
}

/** AniDB's `year` field is "YYYY-YYYY", "YYYY", or already parsed to a number. Take the first 4 digits. */
function parseYear(raw: string | number | null): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const s = String(raw);
	const m = s.match(/^(\d{4})/);
	return m ? Number(m[1]) : null;
}

/**
 * Belt-and-braces year resolver. Three-fallback chain:
 *
 *   1. UDP amask `year` field (canonical, "YYYY" or "YYYY-YYYY")
 *   2. `start_date` (air_date amask field, unix seconds UTC)
 *   3. `end_date`  (end_date amask field, unix seconds UTC)
 *
 * Migrations 009 + 010 apply the same chain to legacy rows. With this in
 * place, year=NULL only when AniDB has provided no date information of
 * any kind for the aid — typically merged / placeholder records that
 * won't survive a re-fetch.
 *
 * If AniDB later populates the canonical year field, the next ANIME
 * fetch overwrites the derived value.
 */
function deriveYear(
	yearRaw: string | number | null,
	startDate: number | null,
	endDate: number | null
): number | null {
	const parsed = parseYear(yearRaw);
	if (parsed !== null) return parsed;
	if (typeof startDate === 'number' && startDate > 0) {
		return new Date(startDate * 1000).getUTCFullYear();
	}
	if (typeof endDate === 'number' && endDate > 0) {
		return new Date(endDate * 1000).getUTCFullYear();
	}
	return null;
}

/**
 * AniDB ANIME response uses TWO different in-field list separators —
 * docs/udp-docs.md lines 857-858 are explicit:
 *
 *   - "Synonyms and short names are separated with '"      → splitAposList
 *   - "Category fields are separated with ','"             → splitList
 *
 * The split per concrete field is:
 *
 *   COMMA-separated (splitList):
 *     - tag_name_list, tag_id_list, tag_weight_list  (verified via
 *       scripts/probe-anime.mjs 2026-05-16)
 *     - character_id_list                            (verified)
 *     - related_aid_list, related_aid_type           (assumed — same family)
 *
 *   APOSTROPHE-separated (splitAposList):
 *     - synonym_list, short_name_list                (docs line 857)
 *     - other_names is singular per spec ("str other name"); the helper
 *       tolerates either layout for a single-value field.
 *
 * Earlier versions of this file had a single splitter on either "'" or
 * "," — both were wrong for one half of the field set. The all-comma
 * version (commit f5b9246) silently collapsed every synonym_list entry
 * into a single comma-joined cell in anime_title, which would have
 * surfaced the first time a user looked for an anime with > 1 synonym.
 */
function splitList(raw: string | null): string[] {
	if (!raw) return [];
	return raw.split(',').filter((s) => s.length > 0);
}
function splitAposList(raw: string | null): string[] {
	if (!raw) return [];
	return raw.split("'").filter((s) => s.length > 0);
}
