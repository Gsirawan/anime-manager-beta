import { animeFetch } from './animeFetch';
import { animeDescFetch } from './animeDescFetch';
import { updatedSync } from './updatedSync';
import { mylistAdd } from './mylistAdd';
import { mylistDel } from './mylistDel';
import { mylistEdit } from './mylistEdit';
import { titlesDumpRefresh } from './titlesDumpRefresh';
import { originBackfillComplete } from './originBackfillComplete';
import type { JobHandlers } from '../worker';

// `character_fetch` stays a no-op — character details (description, seiyuu)
// come via a separate UDP CHARACTER command not wired up in this refactor.
// Old jobs still resolve cleanly via this stub.
const noop = async () => {};

export const handlers: JobHandlers = {
	anime_fetch: animeFetch as any,
	anime_desc_fetch: animeDescFetch as any,
	updated_sync: updatedSync as any,
	mylist_add: mylistAdd as any,
	mylist_del: mylistDel as any,
	mylist_edit: mylistEdit as any,
	character_fetch: noop as any,
	titles_dump_refresh: titlesDumpRefresh as any,
	origin_backfill_complete: originBackfillComplete as any
};
