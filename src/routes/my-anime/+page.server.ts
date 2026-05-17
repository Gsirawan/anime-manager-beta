import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listAnime, type ListParams } from '$lib/server/db/queries/animeList';
import {
	getTypes,
	getYears,
	getTopGenres,
	getStatusCounts,
	getYearCounts,
	getYearUnknownCount,
	getTypeCounts,
	getRatingBucketCounts
} from '$lib/server/db/queries/facets';

export const load: PageServerLoad = ({ url }) => {
	const db = getDb();
	const p: ListParams = {
		tab: 'my',
		status: (url.searchParams.get('status') as ListParams['status']) ?? undefined,
		type: url.searchParams.get('type') ?? undefined,
		year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined,
		season: (url.searchParams.get('season') as ListParams['season']) ?? undefined,
		genre: url.searchParams.get('genre') ?? undefined,
		rating_min: url.searchParams.get('rating_min')
			? Number(url.searchParams.get('rating_min'))
			: undefined,
		q: url.searchParams.get('q') ?? undefined,
		limit: 50
	};
	return {
		page: listAnime(db, p),
		facets: { types: getTypes(db), years: getYears(db), genres: getTopGenres(db) },
		counts: {
			status: getStatusCounts(db),
			year: getYearCounts(db, 'my-anime'),
			yearUnknown: getYearUnknownCount(db, 'my-anime'),
			type: getTypeCounts(db, 'my-anime'),
			rating: getRatingBucketCounts(db, 'my-anime')
		}
	};
};
