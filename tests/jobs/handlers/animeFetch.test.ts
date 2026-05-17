import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import pino from 'pino';
import { FakeTransport } from '../../../src/lib/server/anidb/transport';
import { Session } from '../../../src/lib/server/anidb/session';
import { RateLimiter } from '../../../src/lib/server/anidb/rateLimiter';
import { runMigrations } from '../../../src/lib/server/db/migrations/runner';
import { animeFetch } from '../../../src/lib/server/jobs/handlers/animeFetch';
import { pendingCount } from '../../../src/lib/server/db/repositories/jobs';

function mkCtx(reply: string) {
	const db = new Database(':memory:');
	runMigrations(db);
	// Seed the JP titles_dump row — the worker's gate would have passed before
	// dispatch; we exercise the handler in isolation.
	db.prepare(`INSERT INTO titles_dump (aid, lang, type, title) VALUES (?, ?, ?, ?)`).run(
		1,
		'x-jat',
		'main',
		'Seikai no Monshou'
	);
	const transport = new FakeTransport([Buffer.from(reply)]);
	const session = new Session(transport as any, {
		user: 'u',
		pass: 'p',
		client: 'c',
		clientver: 1
	});
	session.key = 'KEY';
	const ctx = {
		db,
		session,
		rateLimiter: new RateLimiter({ intervalMs: 2100 }),
		log: pino({ level: 'silent' }),
		banAttempt: 0,
		lastBanAt: 0
	} as any;
	return { db, ctx, transport };
}

// Reply body order (per DEFAULT_FIELDS in commands/anime.ts):
//   aid|year|type|related_aid_list|related_aid_type|
//   romaji_name|kanji_name|english_name|other_names|short_name_list|synonym_list|
//   episodes|air_date|end_date|picname|
//   rating|vote_count|is_18_restricted|
//   tag_name_list|tag_id_list|tag_weight_list|
//   character_id_list
//
// LIST SEPARATORS — per docs/udp-docs.md lines 857-858 + the
// 2026-05-16 wire probe:
//
//   COMMA-separated: tag_*, character_id_list, related_aid_*
//   APOSTROPHE-separated: synonym_list, short_name_list, other_names
//
// reply230 uses single-value synonym/short/other so it doesn't matter which
// separator the helper picks — see "persists multiple synonyms" below for
// the multi-value regression test.
function reply230() {
	return (
		'230 ANIME\n' +
		'1|1999|TV Series|2,3|1,2|' +
		'Seikai no Monshou|星界の紋章|Crest of the Stars|Crest of the Stars (US)|SnM|Hoshi no Monshou|' +
		'13|953281200|960000000|seikai.jpg|' +
		'853|3225|0|' +
		'Space,Sci-Fi|100,200|7,8|' +
		'400,401\n'
	);
}

/**
 * Build a 230 ANIME reply with overridable fields. Field order matches
 * DEFAULT_FIELDS. Missing entries render as empty strings between '|'.
 */
function buildReply(opts: {
	aid?: number;
	year?: string;
	type?: string;
	related_aid_list?: string;
	related_aid_type?: string;
	romaji_name?: string;
	kanji_name?: string;
	english_name?: string;
	other_names?: string;
	short_name_list?: string;
	synonym_list?: string;
	episodes?: string;
	air_date?: string;
	end_date?: string;
	picname?: string;
	rating?: string;
	vote_count?: string;
	is_18_restricted?: string;
	tag_name_list?: string;
	tag_id_list?: string;
	tag_weight_list?: string;
	character_id_list?: string;
}) {
	const f = [
		String(opts.aid ?? ''),
		opts.year ?? '',
		opts.type ?? '',
		opts.related_aid_list ?? '',
		opts.related_aid_type ?? '',
		opts.romaji_name ?? '',
		opts.kanji_name ?? '',
		opts.english_name ?? '',
		opts.other_names ?? '',
		opts.short_name_list ?? '',
		opts.synonym_list ?? '',
		opts.episodes ?? '',
		opts.air_date ?? '',
		opts.end_date ?? '',
		opts.picname ?? '',
		opts.rating ?? '',
		opts.vote_count ?? '',
		opts.is_18_restricted ?? '',
		opts.tag_name_list ?? '',
		opts.tag_id_list ?? '',
		opts.tag_weight_list ?? '',
		opts.character_id_list ?? ''
	];
	return '230 ANIME\n' + f.join('|') + '\n';
}

describe('animeFetch (UDP)', () => {
	it('writes last_attempt_at BEFORE the packet (gates next attempt for 14d)', async () => {
		const { db, ctx } = mkCtx(reply230());
		await animeFetch({ aid: 1 }, ctx);
		const row = db.prepare(`SELECT last_attempt_at, fetched_at FROM anime WHERE aid = 1`).get() as {
			last_attempt_at: number;
			fetched_at: number;
		};
		expect(row.last_attempt_at).toBeGreaterThan(0);
		expect(row.fetched_at).toBeGreaterThan(0);
	});

	it('persists anime row with year/type/episodes/picname/rating/restricted', async () => {
		const { db, ctx } = mkCtx(reply230());
		await animeFetch({ aid: 1 }, ctx);
		const row = db.prepare(`SELECT * FROM anime WHERE aid = 1`).get() as any;
		expect(row.year).toBe(1999);
		expect(row.type).toBe('TV Series');
		expect(row.episode_count).toBe(13);
		expect(row.picname).toBe('seikai.jpg');
		expect(row.rating).toBeCloseTo(8.53);
		expect(row.restricted).toBe(0);
	});

	it('persists ALL language titles (romaji, kanji, english, other, short, synonym)', async () => {
		const { db, ctx } = mkCtx(reply230());
		await animeFetch({ aid: 1 }, ctx);
		const titles = db
			.prepare(`SELECT lang, type, title FROM anime_title WHERE aid = 1 ORDER BY lang, type, title`)
			.all() as { lang: string; type: string; title: string }[];
		// Six titles from reply230: romaji + kanji + english + other + short + synonym.
		expect(titles.length).toBe(6);
		expect(titles.some((t) => t.lang === 'x-jat' && t.type === 'main' && t.title === 'Seikai no Monshou')).toBe(true);
		expect(titles.some((t) => t.lang === 'ja' && t.type === 'main' && t.title === '星界の紋章')).toBe(true);
		expect(titles.some((t) => t.lang === 'en' && t.type === 'main' && t.title === 'Crest of the Stars')).toBe(true);
		expect(titles.some((t) => t.lang === 'en' && t.type === 'other' && t.title === 'Crest of the Stars (US)')).toBe(true);
		expect(titles.some((t) => t.lang === 'x-jat' && t.type === 'short' && t.title === 'SnM')).toBe(true);
		expect(titles.some((t) => t.lang === 'en' && t.type === 'synonym' && t.title === 'Hoshi no Monshou')).toBe(true);
	});

	it('persists multiple synonyms / short names via the APOSTROPHE separator', async () => {
		// Per docs/udp-docs.md line 857, synonyms and short names are joined
		// with "'". This was the latent bug behind commit f5b9246 — every
		// synonym_list field collapsed to one row containing the comma-joined
		// (or rather, apostrophe-joined) literal text.
		const reply = buildReply({
			aid: 1,
			year: '1999',
			type: 'TV Series',
			romaji_name: 'Seikai no Monshou',
			english_name: 'Crest of the Stars',
			// other_names is singular per spec — single value.
			other_names: 'Crest of the Stars (US)',
			// Multi-value apostrophe-separated.
			short_name_list: "SnM'COTS",
			synonym_list: "Hoshi no Monshou'Star Crest'Banner of the Stars",
			episodes: '13',
			air_date: '953281200',
			end_date: '960000000',
			picname: 'seikai.jpg',
			rating: '853',
			vote_count: '3225',
			is_18_restricted: '0'
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const synonyms = db
			.prepare(
				`SELECT title FROM anime_title WHERE aid = 1 AND type = 'synonym' ORDER BY title`
			)
			.all() as { title: string }[];
		expect(synonyms.map((s) => s.title)).toEqual([
			'Banner of the Stars',
			'Hoshi no Monshou',
			'Star Crest'
		]);
		const shorts = db
			.prepare(`SELECT title FROM anime_title WHERE aid = 1 AND type = 'short' ORDER BY title`)
			.all() as { title: string }[];
		expect(shorts.map((s) => s.title)).toEqual(['COTS', 'SnM']);
	});

	it('persists tags, relations, and character link rows', async () => {
		const { db, ctx } = mkCtx(reply230());
		await animeFetch({ aid: 1 }, ctx);
		const tags = db.prepare(`SELECT * FROM anime_tag WHERE aid = 1 ORDER BY tag_id`).all() as any[];
		expect(tags.length).toBe(2);
		expect(tags[0].tag_id).toBe(100);
		expect(tags[0].tag_name).toBe('Space');
		expect(tags[0].weight).toBe(7);

		const rels = db
			.prepare(`SELECT * FROM anime_relation WHERE aid = 1 ORDER BY related_aid`)
			.all() as any[];
		expect(rels.length).toBe(2);
		expect(rels[0].related_aid).toBe(2);
		expect(rels[0].type).toBe('1');

		const chars = db
			.prepare(`SELECT * FROM anime_character WHERE aid = 1 ORDER BY char_id`)
			.all() as any[];
		expect(chars.length).toBe(2);
		expect(chars[0].char_id).toBe(400);
		expect(chars[1].char_id).toBe(401);
	});

	it('tombstones aid on 330 NO SUCH ANIME', async () => {
		const { db, ctx } = mkCtx('330 NO SUCH ANIME\n');
		await animeFetch({ aid: 1 }, ctx);
		const tomb = db.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_1'`).get() as
			| { value: string }
			| undefined;
		expect(tomb?.value).toMatch(/^no_such_anime\|/);
	});

	it('throws on 555 BANNED (worker catches and applies penalty)', async () => {
		const { ctx } = mkCtx('555 BANNED\n');
		await expect(animeFetch({ aid: 1 }, ctx)).rejects.toThrow(/555|BANNED/i);
	});

	it('enqueues a follow-up anime_desc_fetch on success', async () => {
		const { db, ctx } = mkCtx(reply230());
		await animeFetch({ aid: 1 }, ctx);
		expect(pendingCount(db)).toBeGreaterThan(0);
		const job = db
			.prepare(`SELECT kind, params_json FROM job WHERE status='pending' LIMIT 1`)
			.get() as { kind: string; params_json: string };
		expect(job.kind).toBe('anime_desc_fetch');
		expect(JSON.parse(job.params_json)).toEqual({ aid: 1 });
	});

	// Post-fetch origin-tag classifier behavior (JP filter rework).

	it('tombstones the aid as non_japanese when origin tag is Korean production', async () => {
		const reply = buildReply({
			aid: 1,
			year: '2020',
			type: 'TV Series',
			romaji_name: 'Hangul no Nani',
			episodes: '12',
			air_date: '1577836800',
			rating: '700',
			vote_count: '100',
			is_18_restricted: '0',
			tag_name_list: 'Korean production',
			tag_id_list: '12345',
			tag_weight_list: '500',
			character_id_list: ''
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_1'`)
			.get() as { value: string } | undefined;
		expect(tomb?.value).toMatch(/^non_japanese\|\d+$/);
		// Anime row still persisted — tombstone is a UI filter, not a delete.
		const row = db.prepare('SELECT aid FROM anime WHERE aid = 1').get();
		expect(row).toBeTruthy();
	});

	it('does NOT enqueue anime_desc_fetch when the aid is tombstoned post-fetch', async () => {
		const reply = buildReply({
			aid: 1,
			year: '2020',
			type: 'TV Series',
			romaji_name: 'Hangul no Nani',
			episodes: '12',
			tag_name_list: 'Korean production',
			tag_id_list: '12345',
			tag_weight_list: '500'
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const descJobs = db
			.prepare(`SELECT COUNT(*) AS n FROM job WHERE kind = 'anime_desc_fetch'`)
			.get() as { n: number };
		expect(descJobs.n).toBe(0);
	});

	it('does NOT tombstone when classifier returns keep (Japanese production)', async () => {
		const reply = buildReply({
			aid: 1,
			year: '2020',
			type: 'TV Series',
			romaji_name: 'Nippon no Anime',
			episodes: '12',
			tag_name_list: 'Japanese production',
			tag_id_list: '2607',
			tag_weight_list: '500'
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_1'`)
			.get();
		expect(tomb).toBeUndefined();
	});

	it('does NOT tombstone when classifier sees only genre tags (untagged origin → permissive keep)', async () => {
		const reply = buildReply({
			aid: 1,
			year: '2020',
			type: 'TV Series',
			romaji_name: 'Untagged Anime',
			episodes: '12',
			tag_name_list: 'Action,Comedy',
			tag_id_list: '1,2',
			tag_weight_list: '300,250'
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const tomb = db
			.prepare(`SELECT value FROM meta WHERE key = 'tombstone_anime_1'`)
			.get();
		expect(tomb).toBeUndefined();
	});

	// ─── deriveYear fallback — year column never NULL when start_date is set ──
	//
	// Defense-in-depth for the bug behind migration 009: 56 prod rows had
	// year=NULL because the old parser tripped on AniDB's "YYYY-YYYY" range
	// format. parseYear handles that now, but if AniDB ever sends a year
	// field that doesn't start with 4 digits (empty, weird placeholder, etc.)
	// the persist site falls back to start_date's year.
	it('derives year from start_date when amask year is empty', async () => {
		const reply = buildReply({
			aid: 1,
			year: '', // amask year field empty — old behaviour persisted NULL
			type: 'TV Series',
			romaji_name: 'No-Year Anime',
			episodes: '12',
			air_date: '1767225600' // 2026-01-01 00:00:00 UTC
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const row = db.prepare(`SELECT year, start_date FROM anime WHERE aid = 1`).get() as {
			year: number | null;
			start_date: number | null;
		};
		expect(row.start_date).toBe(1767225600);
		expect(row.year).toBe(2026); // derived, not NULL
	});

	it('derives year from end_date when both amask year and start_date are missing', async () => {
		// 3rd-fallback path. Finished-airing aid where AniDB recorded only
		// the end. Without this fallback, year would stay NULL and the aid
		// would sit in the Unknown sidebar row indefinitely.
		const reply = buildReply({
			aid: 1,
			year: '',
			type: 'TV Series',
			romaji_name: 'End-Date-Only Anime',
			episodes: '13',
			// air_date intentionally empty
			end_date: '1704067200' // 2024-01-01 00:00:00 UTC
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const row = db.prepare(`SELECT year, start_date, end_date FROM anime WHERE aid = 1`).get() as {
			year: number | null;
			start_date: number | null;
			end_date: number | null;
		};
		expect(row.start_date).toBeNull();
		expect(row.end_date).toBe(1704067200);
		expect(row.year).toBe(2024); // derived from end_date
	});

	it('coerces AniDB sentinel 0 to NULL on start_date and end_date', async () => {
		// AniDB returns 0 to mean "date unknown". Storing the literal 0 makes
		// downstream code (year derivation, season filter, info-tab range)
		// behave as if the anime aired/ended at the unix epoch (1970).
		// Regression for the year=1970 bug on aid 19238.
		const reply = buildReply({
			aid: 1,
			year: '', // amask year empty
			type: 'TV Series',
			romaji_name: 'Date-Sentinel Anime',
			episodes: '12',
			air_date: '0', // AniDB unknown sentinel
			end_date: '0'
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const row = db
			.prepare(`SELECT year, start_date, end_date FROM anime WHERE aid = 1`)
			.get() as { year: number | null; start_date: number | null; end_date: number | null };
		// All three must be NULL — no 0 storage, no 1970 derivation.
		expect(row.start_date).toBeNull();
		expect(row.end_date).toBeNull();
		expect(row.year).toBeNull();
	});

	it('keeps year=NULL when amask year, start_date AND end_date are all missing', async () => {
		const reply = buildReply({
			aid: 1,
			year: '',
			type: 'TV Series',
			romaji_name: 'No-Date-Anywhere Anime',
			episodes: '12'
			// all date fields intentionally omitted
		});
		const { db, ctx } = mkCtx(reply);
		await animeFetch({ aid: 1 }, ctx);
		const row = db
			.prepare(`SELECT year, start_date, end_date FROM anime WHERE aid = 1`)
			.get() as { year: number | null; start_date: number | null; end_date: number | null };
		expect(row.start_date).toBeNull();
		expect(row.end_date).toBeNull();
		expect(row.year).toBeNull(); // no source anywhere
	});
});
