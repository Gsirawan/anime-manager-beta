import { getDb } from './db';
import { config } from './config';
import { logger } from './logger';
import { DgramTransport } from './anidb/transport';
import { Session } from './anidb/session';
import { RateLimiter } from './anidb/rateLimiter';
import { runWorkerLoop, hydrateWorkerContext } from './jobs/worker';
import type { WorkerContext } from './jobs/context';
import { handlers } from './jobs/handlers';
import { registerSchedules } from './scheduler/register';

let booted = false;
let _rateLimiter: RateLimiter | null = null;
let _session: Session | null = null;
let _stop: { stopped: boolean } | null = null;
let _scheduler: { stop(): void } | null = null;

export function bootRuntime(): void {
	if (booted) return;
	booted = true;
	const db = getDb();
	// 4 s spacing — AniDB UDP § Anti-Flood (docs/udp-docs.md lines 155-159):
	//   short term: 1 packet / 2 s (server starts enforcing after 5 packets)
	//   long  term: 1 packet / 4 s over "extended" time
	// We previously used 2.1 s. That's safe for ad-hoc traffic (mylist edits,
	// the daily UPDATED probe, a handful of detail-view fetches) but
	// catastrophic for batch work: the JP-origin backfill enqueues 95 ANIME +
	// 95 ANIMEDESC = ~190 packets back-to-back, ~7 min sustained at 2.1 s ≈
	// 2× the long-term cap. That tripped a flood ban on 2026-05-16 after the
	// 3rd consecutive force-backfill (migrations 005, 006, 007). 4 s puts us
	// safely under the long-term threshold even with a full backfill.
	const rl = new RateLimiter({ intervalMs: 4000 });
	const transport = new DgramTransport(config.ANIDB_SERVER, config.ANIDB_PORT, rl, config.ANIDB_LOCAL_PORT);
	const session = new Session(transport, {
		user: config.ANIDB_USER ?? '',
		pass: config.ANIDB_PASS ?? '',
		client: config.ANIDB_CLIENT,
		clientver: config.ANIDB_CLIENTVER
	});
	_rateLimiter = rl;
	_session = session;
	const stop = { stopped: false };
	_stop = stop;
	const ctx: WorkerContext = {
		db,
		session,
		rateLimiter: rl,
		log: logger,
		banAttempt: 0,
		lastBanAt: 0
	};
	hydrateWorkerContext(ctx);
	runWorkerLoop(ctx, handlers, stop).catch((err) => {
		logger.error({ err }, 'worker loop crashed');
	});
	_scheduler = registerSchedules(db, logger);

	const shutdown = async () => {
		logger.info('shutdown: stopping worker + scheduler');
		if (_stop) _stop.stopped = true;
		_scheduler?.stop();
		try {
			await _session?.logout();
		} catch {}
		await transport.close();
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
}

export function getRateLimiter(): RateLimiter | null {
	return _rateLimiter;
}
