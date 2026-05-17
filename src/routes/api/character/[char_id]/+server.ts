import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { byId } from '$lib/server/db/repositories/character';
import { enqueue } from '$lib/server/db/repositories/jobs';
import { ok, err, pending } from '$lib/server/api';

export const GET: RequestHandler = ({ params }) => {
	const charId = Number(params.char_id);
	if (!Number.isFinite(charId)) return err('bad_id', 'char_id invalid', 400);
	const row = byId(getDb(), charId);
	if (row && row.fetched_at) return ok(row);
	const jobId = enqueue(getDb(), {
		kind: 'character_fetch',
		params: { char_id: charId },
		priority: 5
	});
	return pending(jobId, 3);
};
