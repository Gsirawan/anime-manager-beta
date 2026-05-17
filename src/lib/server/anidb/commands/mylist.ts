import type { Session } from '../session';
import { parseHeader, REPLY } from '../codes';

export interface MylistAddOpts {
	state: number; // 0 unknown, 1 on hdd, 2 on cd, 3 deleted
	viewed: 0 | 1;
}

export interface MylistAddResult {
	added: boolean;
	edited: boolean;
}

/**
 * Add (or auto-edit, if already present) a generic mylist entry for an anime.
 *
 * AniDB's UDP MYLISTADD requires a 'fileinfo' block (fid / size+ed2k / lid)
 * OR an 'animeinfo' block (aid + group_or_generic + epno). Watchlist-only
 * clients have no file info, so we use `generic=1&epno=1` — the convention
 * for "I am tracking this anime, no specific files."
 *
 * NOTE on the lid: for animeinfo adds, the 210 reply body is the *count* of
 * entries added (typically "1"), NOT the lid. Different reply shape from
 * fileinfo adds. We therefore don't try to capture a lid here — subsequent
 * edits go through `mylistEditGeneric` which matches by aid+generic+epno
 * (the same composite key we used to add).
 *
 * On 310 ALREADY_IN_MYLIST: auto-resends with `&edit=1`. AniDB sees the
 * composite key and updates the existing entry.
 */
export async function mylistAddAnime(
	session: Session,
	aid: number,
	opts: MylistAddOpts
): Promise<MylistAddResult> {
	const base = `MYLISTADD aid=${aid}&generic=1&epno=1&state=${opts.state}&viewed=${opts.viewed}`;
	const r1 = await session.sendWithSession(base);
	const h1 = parseHeader(r1);
	if (h1.code === REPLY.MYLIST_ADDED) return { added: true, edited: false };
	if (h1.code === REPLY.ALREADY_IN_MYLIST) {
		const r2 = await session.sendWithSession(`${base}&edit=1`);
		const h2 = parseHeader(r2);
		if (h2.code === REPLY.MYLIST_EDITED) return { added: false, edited: true };
		throw new Error(`MYLISTADD edit failed: ${h2.code} ${h2.rest}`);
	}
	throw new Error(`MYLISTADD failed: ${h1.code} ${h1.rest}`);
}

/**
 * Edit an existing generic mylist entry by composite key (aid+generic+epno).
 * No lid required. AniDB matches on the same composite we used to add.
 */
export async function mylistEditGeneric(
	session: Session,
	aid: number,
	opts: Partial<MylistAddOpts>
): Promise<void> {
	const parts = [`MYLISTADD aid=${aid}`, 'generic=1', 'epno=1', 'edit=1'];
	if (opts.state !== undefined) parts.push(`state=${opts.state}`);
	if (opts.viewed !== undefined) parts.push(`viewed=${opts.viewed}`);
	const r = await session.sendWithSession(parts.join('&'));
	const h = parseHeader(r);
	if (h.code !== REPLY.MYLIST_EDITED) {
		throw new Error(`MYLISTADD edit (aid=${aid}, generic) failed: ${h.code} ${h.rest}`);
	}
}
