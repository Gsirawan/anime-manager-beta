-- Clean up AniDB's "0" sentinel for unknown dates.
--
-- AniDB encodes "date unknown" as integer 0 (per the UDP spec's
-- dateflags convention). Earlier animeFetch.ts code persisted the
-- literal 0 into anime.start_date / anime.end_date, then migrations
-- 009 + 010 derived year from those columns using IS NOT NULL — but
-- 0 is not NULL, so the derivation ran strftime('%Y', 0, 'unixepoch')
-- and got '1970'. Result: 6 aids show year 1970 (e.g. aid 19238)
-- when AniDB actually has no year for them.
--
-- Two-step cleanup:
--   1. Convert sentinel 0 dates to NULL on both columns. This also
--      fixes the "ended in 1970" cosmetic bug on the info tab for
--      45 aids whose end_date was 0 (still-airing or unknown end).
--   2. Clear the year=1970 pollution from rows whose only year
--      source was a now-NULL date. If end_date is still set with a
--      real timestamp (not 0), re-derive year from it; otherwise
--      leave year NULL.
--
-- After this migration:
--   - start_date / end_date are NULL where AniDB had no date info
--   - year is NULL on the 6 bug-victim aids (they show in the
--     Unknown sidebar row, which is correct — AniDB has no year)
--   - "Aired" range on the detail page renders cleanly (no "1970")
--
-- The animeFetch.ts persist path now normalises 0 → NULL up front,
-- so new fetches won't re-introduce the pollution.

UPDATE anime SET start_date = NULL WHERE start_date = 0;
UPDATE anime SET end_date   = NULL WHERE end_date   = 0;

-- Pollution victims: year=1970 + no usable date source → clear year.
UPDATE anime
SET year = NULL,
    updated_at = unixepoch()
WHERE year = 1970
  AND start_date IS NULL
  AND end_date   IS NULL;

-- Defensive: any year=1970 victim that still has a valid end_date
-- (start_date was 0/NULL but end_date is real) — re-derive year from
-- end_date. Doesn't fire on the current dataset because every 1970
-- victim had end_date = 0, but future-proofs the migration.
UPDATE anime
SET year = CAST(strftime('%Y', end_date, 'unixepoch') AS INTEGER),
    updated_at = unixepoch()
WHERE year = 1970
  AND start_date IS NULL
  AND end_date   IS NOT NULL;
