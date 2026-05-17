import { downloadTitles } from '../../anidb/titlesDump';
import { upsertMany, resetFts } from '../../db/repositories/titles';
import { getMeta, setMeta } from '../../db/repositories/meta';
import type { WorkerContext } from '../context';

const TITLES_URL = 'https://anidb.net/api/anime-titles.xml.gz';
const TWENTY_FOUR_HOURS_SEC = 24 * 3600;

/**
 * Daily titles-dump refresh.
 *
 * AniDB's docs explicitly warn:
 *   "do not request anime-titles.xml.gz more than once a day, ban risk"
 *
 * Cron fires this job daily, but the manual trigger (POST /api/sync/titles)
 * could fire it again. We self-rate-limit here so the HTTP request is
 * NEVER sent more than once per 24h regardless of how many jobs enqueue.
 * The ETag/Last-Modified headers are still useful (server returns 304 when
 * content is unchanged), but they don't replace the daily limit — sending
 * the conditional request still hits AniDB's HTTP server, and that's what
 * the rate-limit policy measures.
 */
export async function titlesDumpRefresh(_params: unknown, ctx: WorkerContext): Promise<void> {
	const nowSec = Math.floor(Date.now() / 1000);
	const lastAt = Number(getMeta(ctx.db, 'titles_dump_last_at') ?? 0);
	if (lastAt && nowSec - lastAt < TWENTY_FOUR_HOURS_SEC) {
		ctx.log.info(
			{ lastAt, sinceSec: nowSec - lastAt },
			'titles_dump_refresh: <24h since last run, skipping (AniDB rate-limit compliance)'
		);
		return;
	}

	const prevEtag = getMeta(ctx.db, 'titles_dump_etag') ?? undefined;
	const prevLM = getMeta(ctx.db, 'titles_dump_last_modified') ?? undefined;
	const result = await downloadTitles(TITLES_URL, prevEtag, prevLM);
	// Stamp BEFORE the unchanged-check so a 304 still counts as "ran today"
	// and prevents another HTTP hit until tomorrow.
	setMeta(ctx.db, 'titles_dump_last_at', String(nowSec));
	if (result.notModified) {
		ctx.log.info('titles dump unchanged');
		return;
	}
	ctx.db.exec('DELETE FROM titles_dump');
	upsertMany(ctx.db, result.rows);
	resetFts(ctx.db);
	if (result.etag) setMeta(ctx.db, 'titles_dump_etag', result.etag);
	if (result.lastModified) setMeta(ctx.db, 'titles_dump_last_modified', result.lastModified);
	ctx.log.info({ rows: result.rows.length }, 'titles dump refreshed');
}
