import { json } from '@sveltejs/kit';
import type { ApiResult } from '../types';

export function ok<T>(data: T, init?: ResponseInit): Response {
	return json({ ok: true, data } as ApiResult<T>, init);
}
export function err(code: string, message: string, status = 400): Response {
	return json({ ok: false, error: { code, message } } as ApiResult<never>, { status });
}
export function pending(jobId: number, retryAfterSeconds = 3): Response {
	return json(
		{
			ok: true,
			data: { status: 'pending', job_id: jobId, retry_after_seconds: retryAfterSeconds }
		} as ApiResult<unknown>,
		{ status: 202, headers: { 'Retry-After': String(retryAfterSeconds) } }
	);
}
