import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listAnime, sortToOrderParams, type ListParams } from '$lib/server/db/queries/animeList';
import { ok, err } from '$lib/server/api';

export const GET: RequestHandler = ({ url }) => {
	const tab = (url.searchParams.get('tab') ?? 'my') as 'my' | 'world';
	if (tab !== 'my' && tab !== 'world') return err('bad_tab', 'tab must be my|world');
	// Sort continuity: page 1 (server load) and page N (this API) MUST resolve
	// the same orderBy/direction, or the cursor's keyset semantics produce wrong
	// pages. Resolved via the shared sortToOrderParams helper.
	const sortOverride = sortToOrderParams(url.searchParams.get('sort'));
	// year=unknown is the sidebar "Unknown" row's sentinel value — filters
	// to anime where year IS NULL. Anything else parses as a numeric year.
	const yearParam = url.searchParams.get('year');
	const yearFilter: Pick<ListParams, 'year' | 'yearNull'> =
		yearParam === 'unknown'
			? { yearNull: true }
			: yearParam
				? { year: Number(yearParam) }
				: {};
	const p: ListParams = {
		tab,
		status: (url.searchParams.get('status') as ListParams['status']) ?? undefined,
		type: url.searchParams.get('type') ?? undefined,
		genre: url.searchParams.get('genre') ?? undefined,
		...yearFilter,
		season: (url.searchParams.get('season') as ListParams['season']) ?? undefined,
		rating_min: url.searchParams.get('rating_min')
			? Number(url.searchParams.get('rating_min'))
			: undefined,
		q: url.searchParams.get('q') ?? undefined,
		cursor: url.searchParams.get('cursor') ?? undefined,
		limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 50,
		...sortOverride
	};
	return ok(listAnime(getDb(), p));
};
