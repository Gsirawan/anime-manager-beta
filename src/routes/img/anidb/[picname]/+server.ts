import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RequestHandler } from './$types';

const CDN_BASE = 'https://cdn.anidb.net/images/main';
const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const SAFE = /^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|gif|webp)$/i;
const CONTENT_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp'
};

function contentTypeFor(picname: string): string {
	const ext = picname.split('.').pop()?.toLowerCase() ?? '';
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export const GET: RequestHandler = async ({ params }) => {
	const picname = params.picname ?? '';
	if (!SAFE.test(picname)) {
		return new Response('bad filename', { status: 400 });
	}

	const finalPath = path.join(IMAGES_DIR, picname);
	try {
		const buf = await fs.readFile(finalPath);
		return new Response(buf, {
			status: 200,
			headers: {
				'Content-Type': contentTypeFor(picname),
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		});
	} catch {
		/* miss, fetch from CDN below */
	}

	const cdnUrl = `${CDN_BASE}/${picname}`;
	const res = await fetch(cdnUrl);
	if (!res.ok) {
		return new Response(`upstream ${res.status}`, { status: 502 });
	}
	const buf = Buffer.from(await res.arrayBuffer());

	// Atomic write: tmp file in same dir + rename.
	await fs.mkdir(IMAGES_DIR, { recursive: true });
	const tmp = path.join(IMAGES_DIR, `.tmp-${crypto.randomBytes(8).toString('hex')}-${picname}`);
	await fs.writeFile(tmp, buf);
	await fs.rename(tmp, finalPath);

	return new Response(buf, {
		status: 200,
		headers: {
			'Content-Type': contentTypeFor(picname),
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
