-- Skip the 4th backfill at next boot.
--
-- Background:
--   Migrations 005 → 006 → 007 each cleared meta.origin_backfill_done to
--   force a re-fetch of all 95 cached aids under successively-fixed code
--   paths (force flag, byte-5 amask, comma list separator). The 3rd backfill
--   under migration 007 ran ~190 ANIME+ANIMEDESC packets at the old 2.1 s
--   spacing, which exceeded AniDB's long-term rate cap of 1 packet / 4 s
--   (docs/udp-docs.md § Anti-Flood) and triggered a flood ban on the mini PC.
--
--   The runtime.ts rate limiter is now 4000 ms — safe for the full backfill
--   batch. But the 3rd backfill ALREADY persisted correct tag/character/
--   relation data on every successfully-fetched aid before the ban started
--   dropping packets. Re-fetching every aid AGAIN would mean another ~190
--   packets, ~13 minutes of UDP traffic, for negligible additional benefit
--   — and risks re-poking AniDB while the previous ban window is still
--   draining.
--
--   So we SET origin_backfill_done = '1' instead of clearing it. The
--   hydrate path in worker.ts treats '1' as "already done" and skips
--   re-enqueue. Any aids that did NOT successfully fetch under the 3rd
--   backfill (because the ban dropped their packet) will retry naturally
--   the next time they're requested — gated by the 14-day TTL on fetched_at
--   if they got a partial row, or by no-row-at-all triggering a fresh
--   anime_fetch enqueue from the API layer.
--
-- Net effect: zero spontaneous UDP traffic on the next deploy. The next
-- packet AniDB sees is whatever a user navigates to in the UI, or the
-- daily updated_sync cron at 04:00 UTC.

INSERT INTO meta (key, value)
VALUES ('origin_backfill_done', '1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
