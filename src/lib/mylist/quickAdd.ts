import type { WatchStatus } from '$lib/types';

/**
 * Toggle an anime in/out of the mylist with a single click.
 * - If not in mylist: POSTs with status 'plan'.
 * - If already in mylist: DELETEs the entry.
 *
 * Returns the new status ('plan' | null) so callers can update local state.
 */
export async function quickAdd(
	aid: number,
	currentStatus: WatchStatus | null | undefined
): Promise<WatchStatus | null> {
	if (currentStatus) {
		// Already in mylist — remove it
		const r = await fetch(`/api/mylist/${aid}`, { method: 'DELETE' });
		if (!r.ok) throw new Error(`DELETE /api/mylist/${aid} failed: ${r.status}`);
		return null;
	} else {
		// Not in mylist — add with default status 'plan'
		const r = await fetch('/api/mylist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ aid, status: 'plan' })
		});
		if (!r.ok) throw new Error(`POST /api/mylist failed: ${r.status}`);
		return 'plan';
	}
}
