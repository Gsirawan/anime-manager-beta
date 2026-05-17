-- AMASK byte-5 bit-position fix — backfill reset.
--
-- Background:
--   src/lib/server/anidb/amask.ts had a one-bit shift in AMASK_FIELDS byte 5
--   (and dormant bugs in bytes 6 + 7 that were never exercised). The fields
--   ann_id/allcinema_id/animenfo_id/tag_name_list/tag_id_list/tag_weight_list/
--   date_record_updated were each shifted UP by one bit. End effect: a request
--   for tag_name_list set the animenfo_id bit, AniDB returned animenfo_id
--   in the slot the decoder labelled tag_name_list, the handler tried
--   Number('Space') on what it thought were tag IDs, got NaN, and silently
--   skipped every row. 95/95 cached aids ended up with zero tags after the
--   Cycle 1 backfill. character_id_list slot received tag_weight_list data —
--   numeric strings that may have inserted ghost character_id rows on a few
--   anime; the rest got date_record_updated (a single int) which didn't split
--   into multiple ids → 92/95 with zero characters.
--
-- Fix:
--   amask.ts now matches AniDB's spec (docs/udp-docs.md byte 5 = retired,
--   ann_id, allcinema_id, animenfo_id, tag_name_list, tag_id_list,
--   tag_weight_list, date_record_updated). This migration resets the backfill
--   sentinel so hydrateWorkerContext re-enqueues every cached aid with
--   force=true, re-fetching them under the corrected amask.
--
-- We also wipe any ghost anime_character rows seeded from the corrupt
-- character_id_list slot. After re-fetch they'll be repopulated from the
-- actual character_id_list field on the wire.

DELETE FROM meta WHERE key = 'origin_backfill_done';
DELETE FROM anime_character;
