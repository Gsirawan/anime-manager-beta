-- Backend UDP refactor — adds per-aid attempt timestamp, drops dead calendar table.
-- See docs/superpowers/specs/2026-05-15-backend-udp-refactor-design.md

ALTER TABLE anime ADD COLUMN last_attempt_at INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_anime_last_attempt_at ON anime(last_attempt_at);

DROP INDEX IF EXISTS idx_calendar_start;
DROP TABLE IF EXISTS calendar_entry;
