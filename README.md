<div align="center">
  <img src="docs/logo.jpeg" alt="animanager logo" width="160" />
  <h1>animanager</h1>
  <p><em>A self-hosted personal anime manager. AniDB-only, UDP-native, single-user.</em></p>
</div>

---

<div align="center">
  <img src="docs/world-anime-tablet-view.png" alt="World Anime tab — browse latest aired and upcoming anime" width="900" />
</div>

## What it is

A small, focused web app for tracking your anime watchlist. Two top-level views:

- **My Anime** — your watchlist (`plan` / `watching` / `completed` / `on hold` / `dropped`)
- **World Anime** — browse the catalog: All / Top / Latest / Upcoming, filter by year, type, or rating

Built for a single user on a home server. No cloud, no telemetry, no third-party integrations beyond AniDB.

## Gallery

**My Anime** — your watchlist, tablet & phone

<table>
  <tr>
    <td align="center" width="60%">
      <img src="docs/my-anime-tablet-view.png" alt="My Anime — watchlist with status filters on tablet" width="100%" /><br/>
      <sub>My Anime · tablet</sub>
    </td>
    <td align="center" width="40%">
      <img src="docs/my-anime-iphone-view.png" alt="My Anime on iPhone — responsive grid" width="100%" /><br/>
      <sub>My Anime · iPhone</sub>
    </td>
  </tr>
</table>

**World Anime + Detail view** — browse and drill down

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/world-anime-tablet-view.png" alt="World Anime — browse latest and upcoming" width="100%" /><br/>
      <sub>World Anime · tablet</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/single-card-tablet-view.png" alt="Detail view — hero image, description, character strip" width="100%" /><br/>
      <sub>Detail view · tablet</sub>
    </td>
  </tr>
</table>

## Highlights

- **AniDB only.** No MAL / Jikan / third-party fallbacks. Metadata via UDP `ANIME` + `ANIMEDESC`. Recent-changes feed via UDP `UPDATED`. Watchlist sync via UDP `MYLISTADD`.
- **UDP-native client.** Custom rate-limited queue (1 packet / 2.1 s), fixed local source port to avoid port-churn bans, persistent ban-backoff state across restarts, and a 5-layer pre-flight gate (`paused → tombstoned → recently_attempted → recently_fetched → JP-filter`) that decides whether a packet is even worth sending.
- **Japanese-only filter** at three layers: titles dump import, pre-flight gate (non-JP aids tombstoned without sending UDP), and ANIME response persistence.
- **Image proxy** at `/img/anidb/[picname]` with disk caching — components never hotlink the AniDB CDN.
- **Self-rate-limited periodic syncs.** Titles dump at 24h cadence (per AniDB ToS). UPDATED at 72h cadence. Both have their own self-rate-limit on top of cron.
- **SQLite + WAL** with monotonic SQL migrations and full-text search via FTS5.
- **Responsive UI** — desktop tablet phone, dark theme, OKLCH design tokens.
- **Comprehensive test suite** — 138 unit tests covering migrations, repositories, UDP commands, job handlers, pre-flight gate, and API routes.

## Stack

| Layer | Pick |
|---|---|
| Runtime | Node.js 22 (LTS) |
| Language | TypeScript (strict) end-to-end |
| Framework | SvelteKit 5 (full-stack: UI + API routes) |
| Styling | Tailwind + OKLCH design tokens |
| DB | SQLite via `better-sqlite3`, WAL mode |
| UDP client | Node `dgram` + custom rate-limited queue |
| Scheduler | `node-cron` |
| Tests | Vitest + Playwright |
| Logging | `pino` (structured JSON) |
| Deploy | Single Node process, one systemd unit |

## Architecture

One Node process. Three subsystems behind a single SQLite store:

```
SvelteKit Node.js process
├─ HTTP server
│   ├─ UI + /api/*                   reads SQLite only
│   └─ /img/anidb/[picname]          disk-cached image proxy
├─ Job worker (single owner of UDP socket)
│   ├─ pre-flight gate               5-layer fail-fast
│   ├─ UDP transport                 fixed local port, 2.1s spacing
│   └─ ban state in meta             persisted across restarts
└─ Scheduler (cron)
    ├─ daily 03:00 UTC               titles_dump_refresh (HTTP gz, no rate limit)
    └─ daily 04:00 UTC trigger       updated_sync (self-rate-limits to 72h)
              │
              ▼
        SQLite (anime.db, WAL)
        data/images/   ← image cache
```

The job worker is the **only** place that talks to AniDB. HTTP request handlers never block on the network — they read from cache, enqueue jobs if data is missing, return `202 Accepted` for not-yet-cached lookups, and the UI polls until the worker fills the row.

## Status

This README is published as a window into the project. The source is private at the moment — if you'd find it useful for your own setup or learning, open an issue / reach out and we can talk.

## License

[MIT](LICENSE) © 2026 Ghaith Alsirawan
