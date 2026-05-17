import { mylistAddAnime } from '../../anidb/commands/mylist';
import { markSynced } from '../../db/repositories/mylist';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

export async function mylistAdd(
	params: JobParamsOf<'mylist_add'>,
	ctx: WorkerContext
): Promise<void> {
	await mylistAddAnime(ctx.session, params.aid, {
		state: params.state,
		viewed: params.viewed
	});
	markSynced(ctx.db, params.aid, params.state);
}
