import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getRateLimiter } from '$lib/server/runtime';
import { ok } from '$lib/server/api';

// Failures older than this fall out of the indicator. Historic rows stay in DB.
const FAILED_WINDOW_SEC = 86400; // 24h

export const GET: RequestHandler = () => {
	const db = getDb();
	const pending = (
		db.prepare("SELECT COUNT(*) AS n FROM job WHERE status='pending'").get() as { n: number }
	).n;
	const running = (
		db.prepare("SELECT COUNT(*) AS n FROM job WHERE status='running'").get() as { n: number }
	).n;
	const failed = (
		db
			.prepare(
				"SELECT COUNT(*) AS n FROM job WHERE status='failed' AND completed_at >= unixepoch() - ?"
			)
			.get(FAILED_WINDOW_SEC) as { n: number }
	).n;
	const lastError =
		(
			db
				.prepare(
					"SELECT last_error FROM job WHERE status='failed' AND completed_at >= unixepoch() - ? ORDER BY completed_at DESC LIMIT 1"
				)
				.get(FAILED_WINDOW_SEC) as { last_error: string } | undefined
		)?.last_error ?? null;
	const rl = getRateLimiter();
	const pausedUntil = rl?.pausedUntil ?? 0;
	return ok({ pending, running, failed, last_error: lastError, paused_until: pausedUntil });
};
