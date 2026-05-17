import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { config } from '$lib/server/config';
import { getMeta } from '$lib/server/db/repositories/meta';

export const load: PageServerLoad = () => {
	const db = getDb();
	return {
		config: {
			client: config.ANIDB_CLIENT,
			clientver: config.ANIDB_CLIENTVER,
			database_path: config.DATABASE_PATH,
			user_set: Boolean(config.ANIDB_USER)
		},
		sync: {
			titles_dump_last_at: getMeta(db, 'titles_dump_last_at'),
			titles_dump_etag: getMeta(db, 'titles_dump_etag'),
			updated_last_run_at: getMeta(db, 'updated_last_run_at')
		}
	};
};
