import type BetterSqlite3 from 'better-sqlite3';
import { getMeta } from '../db/repositories/meta';

const TTL_14D_SEC = 14 * 86400;

export type GateInput =
	| { kind: 'anime_fetch'; aid: number; force?: boolean }
	| { kind: 'anime_desc_fetch'; aid: number; force?: boolean }
	| { kind: 'updated_sync' }
	| { kind: 'mylist_add'; aid: number }
	| { kind: 'mylist_del'; aid: number }
	| { kind: 'mylist_edit'; aid: number }
	| { kind: 'titles_dump_refresh' }
	| { kind: 'character_fetch'; char_id: number }
	| { kind: 'origin_backfill_complete' };

export type GateReason =
	| 'paused'
	| 'tombstoned'
	| 'recently_attempted'
	| 'recently_fetched';

export interface GateResult {
	send: boolean;
	reason?: GateReason;
}

export interface GateRuntime {
	/** Unix MS. */
	pausedUntil: number;
}

/**
 * The single source of truth for "should this job actually send a UDP packet?"
 *
 * Runs inside the worker BEFORE handler dispatch. Order matters — fail-fast.
 * For aid-bearing jobs the checks are:
 *   1. paused?               → reject 'paused'
 *   2. tombstoned (TTL ok)?  → reject 'tombstoned'
 *   3. last_attempt < 14d?   → reject 'recently_attempted'
 *   4. fetched_at  < 14d?    → reject 'recently_fetched'
 *
 * JP-origin filtering used to live here as a 5th layer ("aid present in
 * titles_dump?"). It moved to the animeFetch handler post-fetch — see
 * src/lib/server/anidb/originTags.ts. The gate no longer touches titles_dump
 * and no longer writes 'non_japanese' tombstones.
 *
 * mylist_*, titles_dump_refresh, updated_sync, character_fetch only check pause.
 */
export function preFlightGate(
	db: BetterSqlite3.Database,
	input: GateInput,
	nowMs: number,
	runtime: GateRuntime
): GateResult {
	// Layer 1 — pause applies to every UDP-touching job kind.
	if (runtime.pausedUntil > nowMs) return { send: false, reason: 'paused' };

	// Non-aid kinds and kinds that bypass JP/TTL only need the pause check.
	if (
		input.kind === 'titles_dump_refresh' ||
		input.kind === 'updated_sync' ||
		input.kind === 'character_fetch' ||
		input.kind === 'mylist_add' ||
		input.kind === 'mylist_del' ||
		input.kind === 'mylist_edit' ||
		input.kind === 'origin_backfill_complete'
	) {
		return { send: true };
	}

	// From here on it's anime_fetch / anime_desc_fetch — aid required.
	const aid = input.aid;
	const nowSec = Math.floor(nowMs / 1000);

	// Layer 2 — tombstones.
	const tomb = getMeta(db, `tombstone_anime_${aid}`);
	if (tomb) {
		const [reason, tsRaw] = tomb.split('|');
		const ts = Number(tsRaw ?? 0);
		if (reason === 'banned' && nowSec - ts >= TTL_14D_SEC) {
			// banned tombstone expired — fall through
		} else {
			return { send: false, reason: 'tombstoned' };
		}
	}

	// Layers 3 + 4 — per-aid TTL, per JOB KIND.
	//   anime_fetch     uses anime.last_attempt_at      + anime.fetched_at
	//   anime_desc_fetch uses anime.desc_last_attempt_at + anime.desc_fetched_at
	// Sharing one TTL column across both kinds broke the description path:
	// animeFetch stamps last_attempt_at = now BEFORE its UDP packet, then
	// enqueues an anime_desc_fetch follow-up. The follow-up would see the
	// fresh stamp and reject as 'recently_attempted', so ANIMEDESC never
	// fired. Each kind tracks its own attempt + success timestamp now.
	const anime = db
		.prepare(
			`SELECT last_attempt_at, fetched_at, desc_last_attempt_at, desc_fetched_at
			 FROM anime WHERE aid = ?`
		)
		.get(aid) as
		| {
				last_attempt_at: number | null;
				fetched_at: number | null;
				desc_last_attempt_at: number | null;
				desc_fetched_at: number | null;
		  }
		| undefined;
	const lastAttempt =
		input.kind === 'anime_desc_fetch' ? anime?.desc_last_attempt_at : anime?.last_attempt_at;
	const lastFetched =
		input.kind === 'anime_desc_fetch' ? anime?.desc_fetched_at : anime?.fetched_at;
	// force=true bypasses the TTL gates. Used by the JP-origin backfill at
	// hydrate time, when a code change (widened amask + new classifier)
	// requires re-fetching cached aids. The 2.1 s rate limiter still
	// applies and the pause + tombstone gates above are still respected.
	if (!input.force) {
		if (lastAttempt && nowSec - lastAttempt < TTL_14D_SEC) {
			return { send: false, reason: 'recently_attempted' };
		}
		if (lastFetched && nowSec - lastFetched < TTL_14D_SEC) {
			return { send: false, reason: 'recently_fetched' };
		}
	}

	return { send: true };
}
