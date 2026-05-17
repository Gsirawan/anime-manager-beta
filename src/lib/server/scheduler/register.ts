import cron from 'node-cron';
import type BetterSqlite3 from 'better-sqlite3';
import { enqueue } from '../db/repositories/jobs';
import type { Logger } from 'pino';

export interface SchedulerHandles {
	stop(): void;
}

export function registerSchedules(db: BetterSqlite3.Database, log: Logger): SchedulerHandles {
	const titlesTask = cron.schedule('0 3 * * *', () => {
		log.info('cron: titles_dump_refresh');
		enqueue(db, { kind: 'titles_dump_refresh', params: {}, priority: 10 });
	});
	// Cron fires DAILY at 04:00 but updated_sync self-rate-limits to 72h via
	// meta.updated_last_run_at — so the effective cadence is every 3 days.
	const updatedTask = cron.schedule('0 4 * * *', () => {
		log.info('cron: updated_sync');
		enqueue(db, { kind: 'updated_sync', params: {}, priority: 10 });
	});
	return {
		stop() {
			titlesTask.stop();
			updatedTask.stop();
		}
	};
}
