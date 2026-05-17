-- Bug fix: pre-flight gate's 14-day TTL was shared between anime_fetch
-- and anime_desc_fetch. animeFetch writes anime.last_attempt_at = now
-- BEFORE its UDP packet (defect-2 protection); then enqueues an
-- anime_desc_fetch follow-up. The desc job's gate then sees the freshly
-- stamped last_attempt_at, fails 'recently_attempted', and never fires
-- ANIMEDESC. Description is never fetched for any anime.
--
-- Fix: per-kind TTL. anime.last_attempt_at remains for anime_fetch.
-- Add anime.desc_last_attempt_at for anime_desc_fetch.

ALTER TABLE anime ADD COLUMN desc_last_attempt_at INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_anime_desc_last_attempt_at ON anime(desc_last_attempt_at);
