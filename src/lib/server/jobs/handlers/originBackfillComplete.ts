import { setMeta } from '../../db/repositories/meta';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

/**
 * Sentinel handler enqueued at the tail of the JP-origin filter rework
 * backfill (see hydrateWorkerContext). Sets the meta flag that prevents
 * re-enqueueing on subsequent boots.
 *
 * Idempotent — calling twice is a no-op beyond the second write.
 */
export async function originBackfillComplete(
	_params: JobParamsOf<'origin_backfill_complete'>,
	ctx: WorkerContext
): Promise<void> {
	setMeta(ctx.db, 'origin_backfill_done', '1');
	ctx.log.info('origin_backfill_done set — JP filter rework backfill complete');
}
