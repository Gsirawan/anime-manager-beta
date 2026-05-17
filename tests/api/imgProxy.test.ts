import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Import the GET handler under test
import { GET } from '../../src/routes/img/anidb/[picname]/+server';

const TMP = path.join(process.cwd(), 'data', 'images');

async function rmTmp() {
	await fs.rm(TMP, { recursive: true, force: true });
}

describe('GET /img/anidb/[picname]', () => {
	beforeEach(async () => {
		await rmTmp();
		vi.restoreAllMocks();
	});

	it('rejects invalid filenames (path traversal)', async () => {
		const event: any = { params: { picname: '../etc/passwd' } };
		const res = await GET(event);
		expect(res.status).toBe(400);
	});

	it('rejects non-image extensions', async () => {
		const event: any = { params: { picname: 'malicious.exe' } };
		const res = await GET(event);
		expect(res.status).toBe(400);
	});

	it('fetches from CDN on miss, writes to disk, second hit reads from disk', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(Buffer.from('FAKE-IMAGE-BYTES'), {
					status: 200,
					headers: { 'content-type': 'image/jpeg' }
				}) as any
			);
		const event: any = { params: { picname: 'test1.jpg' } };
		const res1 = await GET(event);
		expect(res1.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// File should now exist on disk
		const onDisk = await fs.readFile(path.join(TMP, 'test1.jpg'));
		expect(onDisk.toString()).toBe('FAKE-IMAGE-BYTES');

		// Second hit must NOT fetch
		const res2 = await GET(event);
		expect(res2.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('returns 502 when the CDN returns non-200', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(null, { status: 404 }) as any
		);
		const event: any = { params: { picname: 'missing.jpg' } };
		const res = await GET(event);
		expect(res.status).toBe(502);
	});

	it('sends long Cache-Control on cached hit', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(Buffer.from('IMG'), {
				status: 200,
				headers: { 'content-type': 'image/png' }
			}) as any
		);
		const event: any = { params: { picname: 'cache.png' } };
		const res1 = await GET(event);
		expect(res1.headers.get('Cache-Control')).toMatch(/immutable/);
		const res2 = await GET(event);
		expect(res2.headers.get('Cache-Control')).toMatch(/immutable/);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
