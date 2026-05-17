import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { ok, err } from '$lib/server/api';
import {
	getStatusCounts,
	getYearCounts,
	getYearUnknownCount,
	getTypeCounts,
	getRatingBucketCounts
} from '$lib/server/db/queries/facets';

export const GET: RequestHandler = ({ url }) => {
	const scope = url.searchParams.get('scope');
	if (scope !== 'my-anime' && scope !== 'world-anime') {
		return err('bad_scope', 'scope must be my-anime or world-anime', 400);
	}
	const db = getDb();
	const year = getYearCounts(db, scope);
	const yearUnknown = getYearUnknownCount(db, scope);
	const type = getTypeCounts(db, scope);
	const rating = getRatingBucketCounts(db, scope);
	const data =
		scope === 'my-anime'
			? { status: getStatusCounts(db), year, yearUnknown, type, rating }
			: { year, yearUnknown, type, rating };
	return ok(data);
};
