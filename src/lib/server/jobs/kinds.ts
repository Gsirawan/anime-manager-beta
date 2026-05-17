import { z } from 'zod';

export const JobParams = {
	// force=true bypasses the pre-flight gate's 14-day TTL checks
	// (recently_attempted / recently_fetched) so the backfill can re-fetch
	// cached aids under the widened amask. Pause + tombstone gates still apply.
	anime_fetch: z.object({
		aid: z.number().int().positive(),
		force: z.boolean().optional()
	}),
	anime_desc_fetch: z.object({
		aid: z.number().int().positive(),
		force: z.boolean().optional()
	}),
	updated_sync: z.object({}),
	mylist_add: z.object({
		aid: z.number().int().positive(),
		state: z.number().int(),
		viewed: z.union([z.literal(0), z.literal(1)])
	}),
	mylist_del: z.object({ aid: z.number().int().positive() }),
	mylist_edit: z.object({
		aid: z.number().int().positive(),
		state: z.number().int().optional(),
		viewed: z.union([z.literal(0), z.literal(1)]).optional()
	}),
	character_fetch: z.object({ char_id: z.number().int().positive() }),
	titles_dump_refresh: z.object({}),
	// Sentinel job enqueued AFTER all backfill anime_fetch jobs (see
	// hydrateWorkerContext). The handler flips meta.origin_backfill_done
	// to '1' so subsequent boots don't re-enqueue the backfill.
	origin_backfill_complete: z.object({})
} as const;

export type JobKind = keyof typeof JobParams;
export type JobParamsOf<K extends JobKind> = z.infer<(typeof JobParams)[K]>;

export function parseJobParams<K extends JobKind>(kind: K, raw: unknown): JobParamsOf<K> {
	return JobParams[kind].parse(raw) as JobParamsOf<K>;
}
