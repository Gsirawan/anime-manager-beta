import type BetterSqlite3 from 'better-sqlite3';
import { getMeta, setMeta } from '../db/repositories/meta';

export interface BanState {
	/** Unix MS — rate limiter is paused until at least this moment. */
	pausedUntil: number;
	/** Index into BAN_BACKOFF_STEPS_MS — survives restarts. */
	banAttempt: number;
	/** Unix MS — when we last sent any UDP packet (feeds rate limiter spacing). */
	lastCommandAt: number;
}

const KEY_PAUSED_UNTIL = 'udp_paused_until';
const KEY_BAN_ATTEMPT = 'udp_ban_attempt';
const KEY_LAST_COMMAND_AT = 'udp_last_command_at';

export function loadBanState(db: BetterSqlite3.Database): BanState {
	return {
		pausedUntil: Number(getMeta(db, KEY_PAUSED_UNTIL) ?? 0) || 0,
		banAttempt: Number(getMeta(db, KEY_BAN_ATTEMPT) ?? 0) || 0,
		lastCommandAt: Number(getMeta(db, KEY_LAST_COMMAND_AT) ?? 0) || 0
	};
}

export function saveBanState(db: BetterSqlite3.Database, s: BanState): void {
	setMeta(db, KEY_PAUSED_UNTIL, String(s.pausedUntil));
	setMeta(db, KEY_BAN_ATTEMPT, String(s.banAttempt));
	setMeta(db, KEY_LAST_COMMAND_AT, String(s.lastCommandAt));
}

export function recordCommand(db: BetterSqlite3.Database, nowMs: number): void {
	setMeta(db, KEY_LAST_COMMAND_AT, String(nowMs));
}

export function recordBan(
	db: BetterSqlite3.Database,
	pausedUntilMs: number,
	banAttempt: number
): void {
	setMeta(db, KEY_PAUSED_UNTIL, String(pausedUntilMs));
	setMeta(db, KEY_BAN_ATTEMPT, String(banAttempt));
}
