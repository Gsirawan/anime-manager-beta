-- JP-origin filter rework v2 — reset state from the broken first attempt.
--
-- Background:
--   The initial backfill at hydrate enqueued anime_fetch at priority 100 but
--   the pre-flight gate's 14-day TTL on fetched_at rejected every one of them
--   as 'recently_fetched'. The sentinel still ran (no gate-side TTL), so the
--   origin_backfill_done flag flipped to '1' even though no actual re-fetch
--   happened.
--
--   The fix introduces a force=true flag on anime_fetch / anime_desc_fetch
--   that bypasses the TTL checks (but NOT pause or tombstone) when the
--   backfill enqueues. For force to take effect, we need to:
--     1. Reset origin_backfill_done so hydrateWorkerContext re-enqueues.
--     2. Clear old non_japanese tombstones that the now-removed pre-fetch
--        gate wrote during the title-language heuristic era. Those decisions
--        were based on a flawed proxy (title language → origin) and should
--        be re-evaluated under the new tag-based classifier.
--
-- Side effect of (2): some aids that were hidden as non_japanese will be
-- visible again until the next time something fetches them. The new
-- classifier will re-tombstone them (with the correct verdict) once any
-- code path triggers an anime_fetch.

DELETE FROM meta WHERE key = 'origin_backfill_done';
DELETE FROM meta WHERE key LIKE 'tombstone_anime_%' AND value LIKE 'non_japanese|%';
