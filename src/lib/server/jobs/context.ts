import type BetterSqlite3 from 'better-sqlite3';
import type { Session } from '../anidb/session';
import type { RateLimiter } from '../anidb/rateLimiter';
import type { Logger } from 'pino';

export interface WorkerContext {
	db: BetterSqlite3.Database;
	session: Session;
	rateLimiter: RateLimiter;
	log: Logger;
	/**
	 * Count of consecutive ban-class errors. Persists across restarts via the
	 * `meta` table (loadBanState / saveBanState). Walks BAN_BACKOFF_STEPS_MS.
	 */
	banAttempt: number;
	/** When the last ban was recorded, in unix MS. Used for the 24h decay. */
	lastBanAt: number;
}
