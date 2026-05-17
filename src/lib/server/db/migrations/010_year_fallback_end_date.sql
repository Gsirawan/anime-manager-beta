-- Year backfill — 3rd fallback via end_date.
--
-- Migration 009 backfilled year from start_date for rows that had it.
-- This migration covers the remaining edge case: rows where both year
-- AND start_date are NULL but end_date is set (finished-airing aids
-- where AniDB recorded only the end date). Derives year from end_date
-- to push the Unknown sidebar row toward 0.
--
-- After 009 + 010, year=NULL only when AniDB has provided no date
-- information of any kind — typically merged / placeholder records.
-- New fetches use deriveYear() in animeFetch.ts which applies the
-- same chain (UDP year → start_date → end_date).

UPDATE anime
SET year = CAST(strftime('%Y', end_date, 'unixepoch') AS INTEGER),
    updated_at = unixepoch()
WHERE year IS NULL
  AND start_date IS NULL
  AND end_date IS NOT NULL;
