import { writable } from 'svelte/store';
export interface JobStatus {
	pending: number;
	running: number;
	failed: number;
	paused_until: number;
	last_error: string | null;
}
export const jobStatus = writable<JobStatus>({
	pending: 0,
	running: 0,
	failed: 0,
	paused_until: 0,
	last_error: null
});

let timer: ReturnType<typeof setInterval> | null = null;
export function startJobStatusPolling(intervalMs = 5000): void {
	if (timer) return;
	const tick = async () => {
		try {
			const r = await fetch('/api/jobs/status');
			const j = await r.json();
			if (j.ok) jobStatus.set(j.data);
		} catch {}
	};
	tick();
	timer = setInterval(tick, intervalMs);
}
export function stopJobStatusPolling(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}
