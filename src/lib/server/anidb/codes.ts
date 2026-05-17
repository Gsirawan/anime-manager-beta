export const REPLY = {
	LOGIN_ACCEPTED: 200,
	LOGIN_ACCEPTED_NEW_VER: 201,
	LOGGED_OUT: 203,

	ANIME: 230,
	ANIME_DESC: 233,
	UPDATED: 243,
	CHARACTER: 235,
	CALENDAR: 297,

	NO_SUCH_ANIME: 330,
	NO_SUCH_CHARACTER: 350,
	NO_SUCH_EPISODE: 340,
	NO_DATA: 312,
	NO_UPDATES: 343,
	CALENDAR_EMPTY: 397,

	MYLIST_ADDED: 210,
	MYLIST_EDITED: 311,
	ALREADY_IN_MYLIST: 310,
	MYLIST_DELETED: 211,

	LOGIN_FAILED: 500,
	LOGIN_FIRST: 501,
	ACCESS_DENIED: 502,
	CLIENT_VERSION_OUTDATED: 503,
	CLIENT_BANNED: 504,
	ILLEGAL_INPUT: 505,
	INVALID_SESSION: 506,
	BANNED: 555,
	UNKNOWN_COMMAND: 598,
	INTERNAL_ERROR: 600,
	ANIDB_OUT_OF_SERVICE: 601,
	SERVER_BUSY: 602
} as const;

export type ReplyCode = (typeof REPLY)[keyof typeof REPLY];

export function parseHeader(packet: Buffer): { code: number; tag?: string; rest: string } {
	const text = packet.toString('utf8');
	const newline = text.indexOf('\n');
	const headerLine = newline >= 0 ? text.slice(0, newline) : text;
	const body = newline >= 0 ? text.slice(newline + 1) : '';
	const m = headerLine.match(/^(?:(\S+)\s+)?(\d{3})\b(.*)$/);
	if (!m) throw new Error(`unparseable header: ${headerLine}`);
	return { tag: m[1], code: Number(m[2]), rest: body };
}
