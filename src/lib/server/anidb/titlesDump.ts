import sax from 'sax';
import zlib from 'node:zlib';

export interface TitleRow {
	aid: number;
	lang: string;
	type: string;
	title: string;
}

export async function parseTitlesXml(xml: string): Promise<TitleRow[]> {
	return new Promise((resolve, reject) => {
		const parser = sax.parser(true, { lowercase: true });
		const rows: TitleRow[] = [];
		let curAid = 0;
		let curLang = '';
		let curType = '';
		let curText = '';
		let inTitle = false;
		parser.onopentag = (node) => {
			if (node.name === 'anime')
				curAid = Number((node.attributes as Record<string, string>).aid) || 0;
			if (node.name === 'title') {
				inTitle = true;
				curLang = String((node.attributes as Record<string, string>)['xml:lang'] ?? '');
				curType = String((node.attributes as Record<string, string>).type ?? '');
				curText = '';
			}
		};
		parser.ontext = (text) => {
			if (inTitle) curText += text;
		};
		parser.oncdata = (text) => {
			if (inTitle) curText += text;
		};
		parser.onclosetag = (name) => {
			if (name === 'title' && curAid && curText) {
				rows.push({ aid: curAid, lang: curLang, type: curType, title: curText });
				inTitle = false;
			}
		};
		parser.onerror = reject;
		parser.onend = () => resolve(rows);
		parser.write(xml).close();
	});
}

/**
 * JP-only filter for titles_dump rows.
 *
 * Keep an aid only if it has at least one ja or x-jat title (= it's a
 * Japanese-origin anime). Within a kept aid, drop every row whose lang
 * is not ja or x-jat.
 *
 * Both rules apply at import time so titles_dump, the FTS index, and
 * the pre-flight gate's "is this aid JP?" lookup are all consistent.
 */
const JP_LANGS = new Set(['ja', 'x-jat']);

export function filterJapanese(rows: TitleRow[]): TitleRow[] {
	// Pass 1: find aids that have at least one JP title.
	const jpAids = new Set<number>();
	for (const r of rows) {
		if (JP_LANGS.has(r.lang)) jpAids.add(r.aid);
	}
	// Pass 2: keep only JP-lang rows from JP-aid anime.
	return rows.filter((r) => jpAids.has(r.aid) && JP_LANGS.has(r.lang));
}

export interface DownloadResult {
	rows: TitleRow[];
	notModified: boolean;
	etag?: string;
	lastModified?: string;
}

export async function downloadTitles(
	url: string,
	prevEtag?: string,
	prevLastModified?: string
): Promise<DownloadResult> {
	const headers: Record<string, string> = { 'User-Agent': 'anime-manager/1.0' };
	if (prevEtag) headers['If-None-Match'] = prevEtag;
	if (prevLastModified) headers['If-Modified-Since'] = prevLastModified;

	const res = await fetch(url, { headers });
	if (res.status === 304) return { rows: [], notModified: true };
	if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);

	const buf = Buffer.from(await res.arrayBuffer());
	const unzipped = await new Promise<Buffer>((resolve, reject) =>
		zlib.gunzip(buf, (err, b) => (err ? reject(err) : resolve(b)))
	);
	const rows = await parseTitlesXml(unzipped.toString('utf8'));
	// Note: we used to call filterJapanese(rows) here. JP filtering now
	// happens post-fetch via the origin classifier in the animeFetch
	// handler (see src/lib/server/anidb/originTags.ts). The function is
	// retained as an export in case future tooling needs the pure-language
	// pass, but the live import path keeps every row.
	return {
		rows,
		notModified: false,
		etag: res.headers.get('etag') ?? undefined,
		lastModified: res.headers.get('last-modified') ?? undefined
	};
}
