import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listAnime, sortToOrderParams, type ListParams } from '$lib/server/db/queries/animeList';
import {
	getTypes,
	getYears,
	getTopGenres,
	getYearCounts,
	getYearUnknownCount,
	getTypeCounts,
	getRatingBucketCounts
} from '$lib/server/db/queries/facets';

export const load: PageServerLoad = ({ url }) => {
	const db = getDb();
	const sort = url.searchParams.get('sort') ?? 'latest';
	const counts = {
		year: getYearCounts(db, 'world-anime'),
		yearUnknown: getYearUnknownCount(db, 'world-anime'),
		type: getTypeCounts(db, 'world-anime'),
		rating: getRatingBucketCounts(db, 'world-anime')
	};

	// Sort semantics (doctrine update 2026-05-17):
	//   - All        — every anime, start_date DESC, no cutoff
	//   - Top        — every anime, rating DESC, no cutoff
	//   - Latest     — `start_date <= now()`, start_date DESC. Future-dated
	//                  anime would otherwise sit at the top for months.
	//   - Upcoming   — `start_date > now()`, start_date ASC. Future only.
	// Previous "pure sorts, never filter" rule made Latest and Upcoming
	// semantically identical to All, which broke user intent. Cutoffs live
	// in sortToOrderParams and are applied through ListParams.
	//
	// year=unknown is a sentinel for the Unknown sidebar row → year IS NULL.
	const yearParam = url.searchParams.get('year');
	const yearFilter: Pick<ListParams, 'year' | 'yearNull'> =
		yearParam === 'unknown'
			? { yearNull: true }
			: yearParam
				? { year: Number(yearParam) }
				: {};
	const p: ListParams = {
		tab: 'world',
		type: url.searchParams.get('type') ?? undefined,
		...yearFilter,
		season: (url.searchParams.get('season') as ListParams['season']) ?? undefined,
		genre: url.searchParams.get('genre') ?? undefined,
		rating_min: url.searchParams.get('rating_min')
			? Number(url.searchParams.get('rating_min'))
			: undefined,
		q: url.searchParams.get('q') ?? undefined,
		limit: 50
	};

	// Shared with /api/anime — see sortToOrderParams jsdoc for why centralised.
	// 'all' / 'latest' / missing → start_date DESC; 'rating' → rating DESC;
	// 'upcoming' → start_date ASC (oldest first; future-first ranking deferred).
	Object.assign(p, sortToOrderParams(sort));

	return {
		page: listAnime(db, p),
		facets: { types: getTypes(db), years: getYears(db), genres: getTopGenres(db) },
		counts
	};
};
