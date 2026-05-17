import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getDetail } from '$lib/server/db/queries/animeDetail';
import { enqueue } from '$lib/server/db/repositories/jobs';
import { getMeta } from '$lib/server/db/repositories/meta';
import { byAid as mylistByAid } from '$lib/server/db/repositories/mylist';

export const load: PageServerLoad = ({ params }) => {
	const aid = Number(params.aid);
	if (!Number.isFinite(aid) || aid <= 0) throw error(400, 'bad aid');
	const db = getDb();

	// Tombstone gate. Tombstoned aids short-circuit the detail render with
	// an out-of-scope message instead of an empty detail body. The aid may
	// still appear in My Anime with a warning badge (Task 9 wires that), and
	// we surface a hint here if the user got to the detail page from there.
	const tomb = getMeta(db, `tombstone_anime_${aid}`);
	if (tomb) {
		const reason = tomb.split('|')[0];
		const inMylist = mylistByAid(db, aid) !== undefined;
		return {
			aid,
			detail: null,
			jobId: null,
			tombstoned: true,
			tombstoneReason: reason,
			inMylist
		};
	}

	const detail = getDetail(db, aid);
	if (!detail) {
		const jobId = enqueue(db, { kind: 'anime_fetch', params: { aid }, priority: 1 });
		return { aid, detail: null, jobId, tombstoned: false, inMylist: false };
	}
	return { aid, detail, jobId: null, tombstoned: false, inMylist: false };
};
