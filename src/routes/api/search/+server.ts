import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { search } from '$lib/server/db/repositories/titles';
import { ok, err } from '$lib/server/api';

export const GET: RequestHandler = ({ url }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 2) return err('bad_q', 'query must be ≥ 2 chars', 400);
	const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);
	return ok({ hits: search(getDb(), q, limit) });
};
