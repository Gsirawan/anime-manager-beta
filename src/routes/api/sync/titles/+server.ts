import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { enqueue } from '$lib/server/db/repositories/jobs';
import { ok } from '$lib/server/api';

// Manually trigger the AniDB titles dump (HTTP download, not UDP).
// Useful on first boot or whenever the daily cron hasn't fired yet.
export const POST: RequestHandler = () => {
	const id = enqueue(getDb(), { kind: 'titles_dump_refresh', params: {}, priority: 1 });
	return ok({ job_id: id });
};
