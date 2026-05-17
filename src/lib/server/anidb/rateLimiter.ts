export interface RateLimiterOpts {
	intervalMs: number;
}

export class RateLimiter {
	private nextAvailable = 0;
	pausedUntil = 0;

	constructor(private opts: RateLimiterOpts) {}

	async acquire(): Promise<void> {
		const now = Date.now();
		const target = Math.max(now, this.nextAvailable, this.pausedUntil);
		const wait = target - now;
		if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
		this.nextAvailable = Date.now() + this.opts.intervalMs;
	}

	penalty(ms: number): void {
		this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
	}

	/** Hydrate from persisted ban state on worker boot. */
	hydrate(s: { pausedUntil: number; lastCommandAt: number }): void {
		this.pausedUntil = s.pausedUntil;
		this.nextAvailable = s.lastCommandAt + this.opts.intervalMs;
	}
}
