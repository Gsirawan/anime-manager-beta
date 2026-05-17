import { mylistEditGeneric } from '../../anidb/commands/mylist';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

/**
 * "Delete from watchlist" semantics: convert to AniDB state=3 (deleted/unwanted)
 * via a generic edit. Hard-delete via MYLISTDEL isn't possible for generic
 * entries without a stored lid, and AniDB's state=3 conveys the same intent —
 * the entry remains on the profile marked as removed.
 */
export async function mylistDel(
	params: JobParamsOf<'mylist_del'>,
	ctx: WorkerContext
): Promise<void> {
	try {
		await mylistEditGeneric(ctx.session, params.aid, { state: 3 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// 411 — nothing on AniDB's side to mark. Already gone; treat as success.
		if (msg.includes('411')) {
			ctx.log.info({ aid: params.aid }, 'mylist_del: AniDB had no entry (411), nothing to mark');
			return;
		}
		throw e;
	}
}
