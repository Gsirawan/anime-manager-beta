import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { upsertMylistEntry, removeMylistEntry } from '$lib/server/db/queries/mylistOps';
import { byAid } from '$lib/server/db/repositories/mylist';
import { ok, err } from '$lib/server/api';

const PatchBody = z.object({
	status: z.enum(['plan', 'watching', 'completed', 'on_hold', 'dropped']).optional(),
	eps_watched: z.number().int().min(0).optional(),
	score: z.number().int().min(1).max(10).optional(),
	notes: z.string().optional()
});

export const PATCH: RequestHandler = async ({ params, request }) => {
	const aid = Number(params.aid);
	if (!Number.isFinite(aid)) return err('bad_aid', 'aid invalid', 400);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return err('bad_json', 'invalid JSON', 400);
	}
	const parsed = PatchBody.safeParse(body);
	if (!parsed.success) return err('bad_input', parsed.error.message, 400);
	const existing = byAid(getDb(), aid);
	if (!existing) return err('not_found', 'not in mylist', 404);
	upsertMylistEntry(getDb(), {
		aid,
		status: parsed.data.status ?? (existing.status as any),
		...parsed.data
	});
	return ok({ updated: true });
};

export const DELETE: RequestHandler = ({ params }) => {
	const aid = Number(params.aid);
	if (!Number.isFinite(aid)) return err('bad_aid', 'aid invalid', 400);
	removeMylistEntry(getDb(), aid);
	return ok({ removed: true });
};
