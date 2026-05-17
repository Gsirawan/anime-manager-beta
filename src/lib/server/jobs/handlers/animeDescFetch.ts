import { fetchAnimeDesc } from '../../anidb/commands/animeDesc';
import type { WorkerContext } from '../context';
import type { JobParamsOf } from '../kinds';

export async function animeDescFetch(
	params: JobParamsOf<'anime_desc_fetch'>,
	ctx: WorkerContext
): Promise<void> {
	const nowSec = Math.floor(Date.now() / 1000);

	// Record the attempt before the packet leaves — same protection as animeFetch,
	// but on its OWN per-kind column so animeFetch's stamp doesn't block us.
	ctx.db
		.prepare(
			`INSERT INTO anime (aid, desc_last_attempt_at) VALUES (?, ?)
       ON CONFLICT(aid) DO UPDATE SET desc_last_attempt_at = excluded.desc_last_attempt_at`
		)
		.run(params.aid, nowSec);

	const desc = await fetchAnimeDesc(ctx.session, params.aid);

	if (desc === null) {
		// 312 NO DATA — leave description null, mark when we tried.
		ctx.db
			.prepare(`UPDATE anime SET desc_fetched_at = ? WHERE aid = ?`)
			.run(nowSec, params.aid);
		return;
	}

	ctx.db
		.prepare(`UPDATE anime SET description = ?, desc_fetched_at = ? WHERE aid = ?`)
		.run(desc, nowSec, params.aid);
}
