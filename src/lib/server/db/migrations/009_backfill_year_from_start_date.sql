-- Backfill anime.year from anime.start_date for rows persisted before the
-- year-parser fix shipped (commit 6dce77c, 2026-05-17).
--
-- Background:
--   AniDB's UDP ANIME response returns the `year` field as a string. For
--   most anime it's "YYYY" (e.g. "2026"), but for shows spanning multiple
--   years it's "YYYY-YYYY" (e.g. "2024-2025"). The old persistence code
--   coerced this through Number() which mapped the range form to NaN, and
--   stored NULL into anime.year. animeFetch.ts now uses parseYear() which
--   takes the leading 4 digits — but 56 of 96 rows (~59% of catalog) were
--   fetched under the old code and still carry NULL year.
--
--   The 14-day TTL gate in preFlightGate.ts blocks re-fetch of these rows
--   until ~May 30, and even after that, re-fetching just to populate a
--   single integer column wastes 56+ UDP packets when we already hold
--   start_date (the source of truth for "year of airing").
--
--   This migration derives year from start_date — which is exactly what
--   the UI's info tab already shows for these aids. No info loss: the
--   schema only stores a single int anyway, so the range form was already
--   being truncated; computing the start_date's year is the same value
--   that parseYear would extract from "YYYY-YYYY" (the leading 4 digits).
--
--   Rows with NULL start_date are untouched — there's no derivation source.
--   For those, the natural 14-day TTL re-fetch is the only path.
--
-- Net effect after migration:
--   - 56 rows go from year=NULL to year=YYYY (matching their start_date).
--   - Sidebar's "Unknown (56)" row drops to roughly the count of anime
--     with both NULL year AND NULL start_date (currently 1: the
--     no_such_anime tombstoned aid). Year sidebar sum reconciles with
--     type chip sum on natural data, not just via the Unknown row.
--   - Latest/Upcoming sorts unaffected (they key on start_date, which
--     was always populated).

UPDATE anime
SET year = CAST(strftime('%Y', start_date, 'unixepoch') AS INTEGER),
    updated_at = unixepoch()
WHERE year IS NULL
  AND start_date IS NOT NULL;
