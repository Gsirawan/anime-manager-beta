import { fetchUpdated } from '../../anidb/commands/updated';
import { enqueue } from '../../db/repositories/jobs';
import { getMeta, setMeta } from '../../db/repositories/meta';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

const SEVENTY_TWO_HOURS_SEC = 72 * 3600;
const UPDATED_AGE_DAYS = 3;

/**
 * UDP UPDATED-driven refresh job.
 *
 * Replaces the old CALENDAR cron. One UDP packet → up to 200 aids of anime
 * that have changed in the last 3 days → enqueue an anime_fetch per aid.
 * The pre-flight gate inside the worker will then filter each one (JP-only,
 * TTL, tombstone) before any of those packets actually fire.
 *
 * Self-rate-limits to 72h via meta.updated_last_run_at so a daily cron that
 * happens to fire twice in 3 days only sends one UPDATED packet per cycle.
 */
export async function updatedSync(
	_params: JobParamsOf<'updated_sync'>,
	ctx: WorkerContext
): Promise<void> {
	const nowSec = Math.floor(Date.now() / 1000);
	const lastRun = Number(getMeta(ctx.db, 'updated_last_run_at') ?? 0);
	if (lastRun && nowSec - lastRun < SEVENTY_TWO_HOURS_SEC) {
		ctx.log.info(
			{ lastRun, sinceSec: nowSec - lastRun },
			'updated_sync: <72h since last run, skipping'
		);
		return;
	}

	const res = await fetchUpdated(ctx.session, UPDATED_AGE_DAYS);
	for (const aid of res.aids) {
		enqueue(ctx.db, { kind: 'anime_fetch', params: { aid }, priority: 20 });
	}
	setMeta(ctx.db, 'updated_last_run_at', String(nowSec));
	ctx.log.info(
		{ enqueued: res.aids.length, totalCount: res.totalCount },
		'updated_sync complete'
	);
}
