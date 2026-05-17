import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getDb } from '$lib/server/db';
import { upsertMylistEntry } from '$lib/server/db/queries/mylistOps';
import { ok, err } from '$lib/server/api';

const Body = z.object({
	aid: z.number().int().positive(),
	status: z.enum(['plan', 'watching', 'completed', 'on_hold', 'dropped']),
	eps_watched: z.number().int().min(0).optional(),
	score: z.number().int().min(1).max(10).optional(),
	notes: z.string().optional()
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
	upsertMylistEntry(getDb(), parsed.data);
	return ok({ added: true });
};
