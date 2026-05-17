import 'dotenv/config';
import { z } from 'zod';

const Schema = z.object({
	ANIDB_USER: z.string().min(1).optional(),
	ANIDB_PASS: z.string().min(1).optional(),
	ANIDB_CLIENT: z.string().default('animemanager'),
	ANIDB_CLIENTVER: z.coerce.number().int().default(1),
	// HTTP API uses a SEPARATELY registered client name/version. See
	// https://anidb.net/software/ and docs/http-api-docs.md.
	ANIDB_HTTP_CLIENT: z.string().default('animemanager'),
	ANIDB_HTTP_CLIENTVER: z.coerce.number().int().default(1),
	ANIDB_API_KEY: z.string().optional(),
	// AniDB docs: server/port must not be hardcoded, must come from config.
	ANIDB_SERVER: z.string().default('api.anidb.net'),
	ANIDB_PORT: z.coerce.number().int().default(9000),
	// Local UDP source port for outbound AniDB packets. MUST be fixed and
	// reused across restarts — AniDB bans IPs that send from many different
	// source ports within an hour (it looks like NAT abuse to them).
	// Default 9001 because >1024 (unprivileged) and unlikely to collide.
	ANIDB_LOCAL_PORT: z.coerce.number().int().min(1024).max(65535).default(9001),
	PORT: z.coerce.number().int().default(3000),
	DATABASE_PATH: z.string().default('./data/anime.db'),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export const config = Schema.parse(process.env);
export type Config = typeof config;
