import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../../src/lib/server/anidb/rateLimiter';

describe('RateLimiter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('first acquire resolves immediately', async () => {
		const rl = new RateLimiter({ intervalMs: 2100 });
		const p = rl.acquire();
		await vi.advanceTimersByTimeAsync(0);
		await expect(p).resolves.toBeUndefined();
	});

	it('second acquire waits at least intervalMs', async () => {
		const rl = new RateLimiter({ intervalMs: 2100 });
		await rl.acquire();
		const p = rl.acquire();
		await vi.advanceTimersByTimeAsync(2000);
		let done = false;
		p.then(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(200);
		await p;
	});

	it('penalty() extends the wait', async () => {
		const rl = new RateLimiter({ intervalMs: 2100 });
		await rl.acquire();
		rl.penalty(30_000);
		const p = rl.acquire();
		await vi.advanceTimersByTimeAsync(2100);
		let done = false;
		p.then(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(30_000);
		await p;
	});

	it('pausedUntil exposes ban resume time', () => {
		const rl = new RateLimiter({ intervalMs: 2100 });
		rl.penalty(30_000);
		expect(rl.pausedUntil).toBeGreaterThan(Date.now());
	});
});
