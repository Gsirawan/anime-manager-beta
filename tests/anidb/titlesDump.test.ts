import { describe, it, expect, vi, afterEach } from 'vitest';
import zlib from 'node:zlib';
import {
	parseTitlesXml,
	filterJapanese,
	downloadTitles
} from '../../src/lib/server/anidb/titlesDump';

describe('parseTitlesXml', () => {
	it('extracts titles from a sample fragment', async () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<animetitles>
  <anime aid="1">
    <title xml:lang="x-jat" type="main">Seikai no Monshou</title>
    <title xml:lang="en" type="official">Crest of the Stars</title>
  </anime>
  <anime aid="2">
    <title xml:lang="x-jat" type="main">Spice and Wolf</title>
  </anime>
</animetitles>`;
		const rows = await parseTitlesXml(xml);
		expect(rows.length).toBe(3);
		expect(rows[0]).toEqual({ aid: 1, lang: 'x-jat', type: 'main', title: 'Seikai no Monshou' });
		expect(rows[2]).toEqual({ aid: 2, lang: 'x-jat', type: 'main', title: 'Spice and Wolf' });
	});
});

describe('filterJapanese', () => {
	it('keeps only ja and x-jat title rows from JP-origin aids', async () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<animetitles>
  <anime aid="1">
    <title xml:lang="x-jat" type="main">Seikai no Monshou</title>
    <title xml:lang="ja" type="official">星界の紋章</title>
    <title xml:lang="en" type="official">Crest of the Stars</title>
  </anime>
  <anime aid="100">
    <title xml:lang="zh-Hans" type="main">某中文动画</title>
    <title xml:lang="en" type="official">Some Chinese Anime</title>
  </anime>
  <anime aid="200">
    <title xml:lang="ja" type="main">日本のアニメ</title>
    <title xml:lang="en" type="official">A Japanese Anime</title>
  </anime>
</animetitles>`;
		const rows = await parseTitlesXml(xml);
		const kept = filterJapanese(rows);
		// aid 1: keeps x-jat + ja (drops en)
		// aid 100: dropped entirely (no ja/x-jat title)
		// aid 200: keeps ja (drops en)
		expect(kept.length).toBe(3);
		expect(kept.some((r) => r.aid === 100)).toBe(false);
		expect(kept.every((r) => r.lang === 'ja' || r.lang === 'x-jat')).toBe(true);
		expect(kept.filter((r) => r.aid === 1).length).toBe(2);
		expect(kept.filter((r) => r.aid === 200).length).toBe(1);
	});

	it('keeps an empty list empty', () => {
		expect(filterJapanese([])).toEqual([]);
	});
});

describe('downloadTitles', () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns ALL rows from the gzipped XML, including non-JP languages (filter no longer applied)', async () => {
		// Mixed-origin payload: aid 1 has both ja and en titles, aid 2 has Korean only.
		// Under the old filterJapanese rule aid=2 would have been dropped at this layer.
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<animetitles>
  <anime aid="1">
    <title xml:lang="ja" type="main">アニメ</title>
    <title xml:lang="en" type="official">Anime</title>
  </anime>
  <anime aid="2">
    <title xml:lang="ko" type="main">애니메이션</title>
  </anime>
</animetitles>`;
		const gz = zlib.gzipSync(Buffer.from(xml, 'utf8'));
		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			ok: true,
			arrayBuffer: async () =>
				gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
			headers: { get: () => null }
		}) as unknown as typeof fetch;

		const result = await downloadTitles('https://example.invalid/anime-titles.xml.gz');
		expect(result.notModified).toBe(false);
		expect(result.rows).toHaveLength(3);
		// The Korean-only aid must appear — the old downloadTitles dropped it.
		expect(result.rows.some((r) => r.aid === 2 && r.lang === 'ko')).toBe(true);
		// English titles for JP-origin aids also flow through.
		expect(result.rows.some((r) => r.aid === 1 && r.lang === 'en')).toBe(true);
	});
});
