export type WatchStatus = 'plan' | 'watching' | 'completed' | 'on_hold' | 'dropped';

export interface AnimeCardData {
	aid: number;
	type: string | null;
	episode_count: number | null;
	year: number | null;
	picname: string | null;
	rating: number | null;
	title: string;
	mylist_status?: WatchStatus | null;
	/** 1 = AniDB-restricted (NSFW). Render with blur until user hovers. */
	restricted?: 0 | 1 | null;
	/** True when this aid carries any tombstone meta key (e.g. non_japanese).
	 *  Set only on the my-anime tab — world-tab excludes tombstoned aids
	 *  at the SQL layer. UI uses this to render the "Out of scope" badge. */
	tombstoned?: boolean;
}

export interface ApiOk<T> {
	ok: true;
	data: T;
}
export interface ApiErr {
	ok: false;
	error: { code: string; message: string };
}
export type ApiResult<T> = ApiOk<T> | ApiErr;

export interface PendingState {
	status: 'pending';
	job_id: number;
	retry_after_seconds: number;
}
