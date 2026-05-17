import type { Session } from '../session';
import { parseHeader, REPLY } from '../codes';

export interface UpdatedResult {
	aids: number[];
	totalCount: number;
	lastUpdate: number;
}

/**
 * UDP `UPDATED entity=1&age=<days>` — returns up to 200 aid values that
 * have changed in the past `age` days.
 *
 * Reply format (243):
 *   243 UPDATED
 *   {entity}|{total_count}|{last_update_date}|{aid1,aid2,...}
 *
 * Reference: docs/udp-docs.md § UPDATED.
 */
export async function fetchUpdated(session: Session, ageDays: number): Promise<UpdatedResult> {
	const reply = await session.sendWithSession(`UPDATED entity=1&age=${ageDays}`);
	const h = parseHeader(reply);
	if (h.code === REPLY.NO_UPDATES) {
		return { aids: [], totalCount: 0, lastUpdate: 0 };
	}
	if (h.code !== REPLY.UPDATED) {
		throw new Error(`UPDATED failed: ${h.code} ${h.rest}`);
	}
	const body = reply.toString().split('\n')[1] ?? '';
	const parts = body.split('|');
	// parts: [entity, total_count, last_update_date, aid_list]
	const totalCount = Number(parts[1] ?? 0);
	const lastUpdate = Number(parts[2] ?? 0);
	const aidsRaw = parts[3] ?? '';
	const aids = aidsRaw
		.split(',')
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
	return { aids, totalCount, lastUpdate };
}
