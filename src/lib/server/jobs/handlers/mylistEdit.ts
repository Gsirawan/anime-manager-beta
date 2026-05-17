import { mylistAddAnime, mylistEditGeneric } from '../../anidb/commands/mylist';
import { markSynced } from '../../db/repositories/mylist';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

export async function mylistEdit(
	params: JobParamsOf<'mylist_edit'>,
	ctx: WorkerContext
): Promise<void> {
	try {
		await mylistEditGeneric(ctx.session, params.aid, {
			state: params.state,
			viewed: params.viewed
		});
		if (params.state !== undefined) markSynced(ctx.db, params.aid, params.state);
		return;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// 411 NO SUCH MYLIST ENTRY — AniDB doesn't have it anymore (e.g. deleted
		// out-of-band). Fall back to add, which itself handles 310 by auto-editing.
		if (!msg.includes('411')) throw e;
	}
	if (params.state === undefined || params.viewed === undefined) {
		throw new Error(`mylist_edit fallback requires state+viewed (aid=${params.aid})`);
	}
	await mylistAddAnime(ctx.session, params.aid, {
		state: params.state,
		viewed: params.viewed
	});
	markSynced(ctx.db, params.aid, params.state);
}
