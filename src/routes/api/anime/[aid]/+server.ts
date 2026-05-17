import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getDetail } from '$lib/server/db/queries/animeDetail';
import { enqueue } from '$lib/server/db/repositories/jobs';
import { ok, err, pending } from '$lib/server/api';

export const GET: RequestHandler = ({ params }) => {
	const aid = Number(params.aid);
	if (!Number.isFinite(aid) || aid <= 0)
		return err('bad_aid', 'aid must be a positive integer', 400);
	const db = getDb();
	const detail = getDetail(db, aid);
	if (detail) return ok(detail);
	const jobId = enqueue(db, { kind: 'anime_fetch', params: { aid }, priority: 1 });
	return pending(jobId, 3);
};
