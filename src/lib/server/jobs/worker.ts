import { claimNext, enqueue, markDone, markFailed } from '../db/repositories/jobs';
import { getMeta, setMeta } from '../db/repositories/meta';
import { parseJobParams, type JobKind } from './kinds';
import type { WorkerContext } from './context';
import { preFlightGate, type GateInput } from './preFlightGate';
import { loadBanState, recordBan, recordCommand, saveBanState } from './banState';

export type JobHandler = (params: unknown, ctx: WorkerContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

const MAX_ATTEMPTS = 3;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Ban-recovery backoff ladder.
//
// Earlier this file copied the 30 s/2 min/5 min/10 min ladder from
// UDP_API_Definition § Connection Problems — but that quote is about
// LOGIN-attempt retry after a connection failure (server unreachable, etc),
// not flood-ban recovery. Per docs/udp-docs.md line 172, a flood/abuse ban
// "usually lasts 30 minutes". Poking that ban with a packet every 30 s, then
// 2 min, then 5 min is exactly the "dropped packets are still taken into
// account" footgun from line 164 — each retry extends the ban.
//
// New ladder starts at 30 min (matches AniDB's typical ban duration) and
// caps at 24 h. The 24 h healthy-streak decay below resets banAttempt to 0
// after a successful command, so a single transient ban shouldn't snowball.
const BAN_BACKOFF_STEPS_MS = [
	30 * 60_000, // 30 min  (matches AniDB's typical ban duration)
	60 * 60_000, // 1 h
	2 * 60 * 60_000, // 2 h
	4 * 60 * 60_000, // 4 h
	8 * 60 * 60_000, // 8 h
	12 * 60 * 60_000, // 12 h
	24 * 60 * 60_000 // 24 h (cap)
];

// Detect a recoverable ban from the error message. Four classes, all
// transient — the ladder above eventually releases the worker:
//   1. Explicit `555 BANNED Flooding`         (rate-limit ban)
//   2. Explicit `601 ANIDB OUT OF SERVICE`    (docs line 110 — daily
//      maintenance; wait ≥30 min, matches our first ladder rung)
//   3. Explicit `604 TIMEOUT - DELAY AND RESUBMIT` (docs line 98 — delay
//      and resubmit)
//   4. Implicit silent-drop ban — our transport throws `udp timeout` on
//      no-reply. Docs line 162: "all further UDP packets from that client
//      will be dropped without feedback". Net packet loss can also cause
//      this, but the cost asymmetry favours over-pausing: a false pause
//      costs 30 min of latency; a false negative prolongs the ban
//      indefinitely.
const BAN_SIGNAL_REGEX =
	/\b555\b|\b601\b|\b604\b|\bBANNED\b|Flooding|udp timeout|ANIDB OUT OF SERVICE/i;

// `504 CLIENT BANNED - {reason}` is an account-level admin ban (docs line
// 241). Unlike 555 (flood), 504 doesn't release on its own — it requires
// human intervention with AniDB. Treat as a hard stop: park the worker
// for a week, mark the offending job non-retryable, and write a meta key
// so the operator can see it without reading logs. To resume after the
// ban is lifted: `DELETE FROM meta WHERE key IN ('udp_perm_banned',
// 'udp_paused_until');` and restart the service.
const HARD_BAN_REGEX = /\b504\b|CLIENT BANNED/i;
const HARD_BAN_PAUSE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Hydrate ban state from meta into the in-memory ctx + rateLimiter. Call once at boot. */
export function hydrateWorkerContext(ctx: WorkerContext): void {
	const s = loadBanState(ctx.db);
	ctx.rateLimiter.hydrate({ pausedUntil: s.pausedUntil, lastCommandAt: s.lastCommandAt });
	ctx.banAttempt = s.banAttempt;

	// One-shot JP-origin backfill: re-fetch every cached anime under the
	// widened amask so English/synonym titles populate and the origin
	// classifier runs on every aid. Marker stamped at enqueue-time so a
	// mid-backfill restart doesn't re-enqueue.
	//
	// Marker meta value transitions:
	//   null         → never run; enqueue path runs, sets to 'enqueued'
	//   'enqueued'   → enqueued, queue may still be draining → skip
	//   '1'          → sentinel handler has confirmed completion → skip
	const done = getMeta(ctx.db, 'origin_backfill_done');
	if (done === null) {
		const cachedAids = ctx.db
			.prepare(`SELECT aid FROM anime WHERE fetched_at IS NOT NULL ORDER BY aid`)
			.all() as { aid: number }[];
		for (const { aid } of cachedAids) {
			enqueue(ctx.db, {
				kind: 'anime_fetch',
				// force=true bypasses the gate's 14-day TTL — these aids were
				// fetched recently under the old amask and must be re-fetched
				// now to populate English titles + run the origin classifier.
				params: { aid, force: true },
				priority: 100
			});
		}
		enqueue(ctx.db, {
			kind: 'origin_backfill_complete',
			params: {},
			priority: 101
		});
		setMeta(ctx.db, 'origin_backfill_done', 'enqueued');
		ctx.log.info(
			{ aids: cachedAids.length },
			'origin_backfill: enqueued cached aids for re-fetch under widened amask'
		);
	}
}

function buildGateInput(kind: JobKind, params: unknown): GateInput {
	switch (kind) {
		case 'anime_fetch':
		case 'anime_desc_fetch': {
			const p = params as { aid: number; force?: boolean };
			return { kind, aid: p.aid, force: p.force };
		}
		case 'mylist_add':
		case 'mylist_del':
		case 'mylist_edit':
			return { kind, aid: (params as { aid: number }).aid };
		case 'character_fetch':
			return { kind, char_id: (params as { char_id: number }).char_id };
		case 'titles_dump_refresh':
			return { kind };
		case 'updated_sync':
			return { kind };
		case 'origin_backfill_complete':
			return { kind };
	}
}

export async function runWorkerOnce(
	ctx: WorkerContext,
	handlers: JobHandlers
): Promise<'processed' | 'idle' | 'paused' | 'gated'> {
	// If the queue is paused (after a 555 ban), don't claim jobs at all —
	// otherwise every UDP-touching job sits blocked in transport.send waiting
	// for the pause to expire, which still counts as an attempt at AUTH time.
	if (ctx.rateLimiter.pausedUntil > Date.now()) return 'paused';

	const job = claimNext(ctx.db);
	if (!job) return 'idle';

	try {
		const h = handlers[job.kind as JobKind];
		if (!h) throw new Error(`no handler for kind: ${job.kind}`);
		const params = parseJobParams(job.kind as JobKind, job.params);

		const gateInput = buildGateInput(job.kind as JobKind, params);
		const gate = preFlightGate(ctx.db, gateInput, Date.now(), {
			pausedUntil: ctx.rateLimiter.pausedUntil
		});
		if (!gate.send) {
			ctx.log.info(
				{ jobId: job.id, kind: job.kind, reason: gate.reason },
				'pre-flight gate rejected'
			);
			markDone(ctx.db, job.id);
			return 'gated';
		}

		await h(params, ctx);

		// Healthy success → record + decay banAttempt after 24h clean.
		recordCommand(ctx.db, Date.now());
		if (ctx.banAttempt > 0 && Date.now() - ctx.lastBanAt > TWENTY_FOUR_HOURS_MS) {
			ctx.banAttempt = 0;
			saveBanState(ctx.db, {
				pausedUntil: ctx.rateLimiter.pausedUntil,
				banAttempt: 0,
				lastCommandAt: Date.now()
			});
		}
		markDone(ctx.db, job.id);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isHardBan = HARD_BAN_REGEX.test(message);
		const isSoftBan = !isHardBan && BAN_SIGNAL_REGEX.test(message);
		if (isHardBan) {
			// 504 CLIENT BANNED — account-level, admin-issued. Park the worker
			// for a week and stamp a meta key so the operator notices.
			ctx.rateLimiter.penalty(HARD_BAN_PAUSE_MS);
			recordBan(ctx.db, Date.now() + HARD_BAN_PAUSE_MS, ctx.banAttempt);
			ctx.db
				.prepare(
					`INSERT INTO meta (key, value) VALUES ('udp_perm_banned', ?)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
				)
				.run(`${message}|${Math.floor(Date.now() / 1000)}`);
			ctx.log.error(
				{ jobId: job.id, err: message },
				'AniDB hard ban (504) — worker parked for 7 days; manual unban required'
			);
		} else if (isSoftBan) {
			ctx.banAttempt += 1;
			ctx.lastBanAt = Date.now();
			const idx = Math.min(ctx.banAttempt - 1, BAN_BACKOFF_STEPS_MS.length - 1);
			const next = BAN_BACKOFF_STEPS_MS[idx];
			ctx.rateLimiter.penalty(next);
			recordBan(ctx.db, Date.now() + next, ctx.banAttempt);
			// NOTE: do NOT tombstone the offending aid here. Flood / silent-ban
			// signals are rate-limit violations from the CLIENT side — they say
			// nothing about that aid being problematic. The previous behaviour
			// hid random aids for 14 days based on a flood that wasn't their
			// fault. markFailed below re-queues the job; pause + backoff stops
			// the bleed.
			const aid = (job.params as Record<string, unknown> | undefined)?.aid;
			ctx.log.warn(
				{ jobId: job.id, pausedForMs: next, banAttempt: ctx.banAttempt, aid },
				'AniDB ban signal detected (explicit or timeout); queue paused'
			);
		}
		// Hard bans are non-retryable — the operator must intervene. Soft
		// bans + everything else retry up to MAX_ATTEMPTS.
		const retry = !isHardBan && job.attempts < MAX_ATTEMPTS;
		markFailed(ctx.db, job.id, message, retry);
		ctx.log.warn(
			{ jobId: job.id, kind: job.kind, attempts: job.attempts, retry, err: message },
			'job error'
		);
	}
	return 'processed';
}

export async function runWorkerLoop(
	ctx: WorkerContext,
	handlers: JobHandlers,
	stopSignal: { stopped: boolean }
): Promise<void> {
	while (!stopSignal.stopped) {
		const r = await runWorkerOnce(ctx, handlers);
		// Idle or paused → don't burn CPU. While paused, sleep longer.
		if (r === 'idle') await new Promise((res) => setTimeout(res, 1000));
		else if (r === 'paused') await new Promise((res) => setTimeout(res, 5000));
	}
}
