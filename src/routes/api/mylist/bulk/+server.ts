import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { bulkSetStatus, bulkRemove } from '$lib/server/db/queries/mylistOps';
import { enqueue } from '$lib/server/db/repositories/jobs';
import { ok, err } from '$lib/server/api';

const Body = z
	.object({
		aids: z.array(z.number().int().positive()).min(1).max(500),
		action: z.enum(['set_status', 'remove']),
		status: z.enum(['plan', 'watching', 'completed', 'on_hold', 'dropped']).optional()
	})
	.refine((b) => b.action !== 'set_status' || !!b.status, {
		message: 'status is required when action=set_status'
	});

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return err('bad_json', 'invalid JSON', 400);
	}
	const parsed = Body.safeParse(body);
	if (!parsed.success) return err('bad_input', parsed.error.message, 400);

	const db = getDb();

	if (parsed.data.action === 'set_status') {
		// status presence is enforced by the refine above
		const status = parsed.data.status!;
		const r = bulkSetStatus(db, parsed.data.aids, status);
		const enqueued: number[] = [];
		for (const j of r.jobsToEnqueue) {
			enqueued.push(enqueue(db, { kind: j.kind, params: j.params, priority: 5 }));
		}
		return ok({ updated: r.updated, enqueued_jobs: enqueued });
	}

	// remove
	const r = bulkRemove(db, parsed.data.aids);
	const enqueued: number[] = [];
	for (const j of r.jobsToEnqueue) {
		enqueued.push(enqueue(db, { kind: j.kind, params: j.params, priority: 5 }));
	}
	return ok({ removed: r.removed, enqueued_jobs: enqueued });
};
