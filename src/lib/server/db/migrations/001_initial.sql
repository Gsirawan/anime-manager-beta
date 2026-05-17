-- Core anime record (one row per AniDB aid)
CREATE TABLE anime (
  aid             INTEGER PRIMARY KEY,
  type            TEXT,                    -- 'TV Series', 'Movie', 'OVA', 'ONA', 'Special'
  episode_count   INTEGER,
  start_date      INTEGER,                 -- unix timestamp
  end_date        INTEGER,
  year            INTEGER,
  picname         TEXT,
  rating          REAL,
  vote_count      INTEGER,
  temp_rating     REAL,
  url             TEXT,
  restricted      INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  fetched_at      INTEGER,                 -- last ANIME fetch
  desc_fetched_at INTEGER,                 -- last ANIMEDESC fetch
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_anime_start_date ON anime(start_date);
CREATE INDEX idx_anime_year       ON anime(year);
CREATE INDEX idx_anime_type       ON anime(type);
CREATE INDEX idx_anime_rating     ON anime(rating);

-- Titles per anime (multi-language, multi-type)
CREATE TABLE anime_title (
  aid    INTEGER NOT NULL,
  lang   TEXT NOT NULL,                    -- 'en', 'ja', 'x-jat' (romaji), …
  type   TEXT NOT NULL,                    -- 'main', 'official', 'synonym', 'short'
  title  TEXT NOT NULL,
  PRIMARY KEY (aid, lang, type, title),
  FOREIGN KEY (aid) REFERENCES anime(aid) ON DELETE CASCADE
);
CREATE INDEX idx_anime_title_aid ON anime_title(aid);

-- Tags / genres
CREATE TABLE anime_tag (
  aid       INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  tag_name  TEXT NOT NULL,
  weight    INTEGER,
  PRIMARY KEY (aid, tag_id),
  FOREIGN KEY (aid) REFERENCES anime(aid) ON DELETE CASCADE
);
CREATE INDEX idx_anime_tag_name ON anime_tag(tag_name);

-- Related anime (sequels, prequels, side stories)
CREATE TABLE anime_relation (
  aid         INTEGER NOT NULL,
  related_aid INTEGER NOT NULL,
  type        TEXT,
  PRIMARY KEY (aid, related_aid)
);

-- Characters appearing in an anime
CREATE TABLE anime_character (
  aid             INTEGER NOT NULL,
  char_id         INTEGER NOT NULL,
  appearance      INTEGER,                 -- 0 appears, 1 cameo, 2 main, 3 secondary
  creator_id      INTEGER,                 -- voice actor id
  is_main_seiyuu  INTEGER,
  PRIMARY KEY (aid, char_id)
);

-- Character details (lazy-fetched via UDP CHARACTER)
CREATE TABLE character (
  char_id        INTEGER PRIMARY KEY,
  name_kanji     TEXT,
  name_translit  TEXT,
  pic            TEXT,
  gender         TEXT,
  type           INTEGER,                  -- 1 Character, 2 Mecha, 3 Organisation
  fetched_at     INTEGER
);

-- Local watchlist state.
-- AniDB MYLIST tracks file ownership, NOT watchlist state.
-- We keep our own status on top and selectively sync to AniDB.
CREATE TABLE mylist (
  aid                 INTEGER PRIMARY KEY,
  status              TEXT NOT NULL,       -- 'plan','watching','completed','on_hold','dropped'
  eps_watched         INTEGER NOT NULL DEFAULT 0,
  score               INTEGER,             -- 1–10 local user score
  notes               TEXT,
  added_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  anidb_mylist_state  INTEGER,             -- AniDB state field if synced
  anidb_synced_at     INTEGER,
  FOREIGN KEY (aid) REFERENCES anime(aid)
);
CREATE INDEX idx_mylist_status ON mylist(status);

-- Results of UDP CALENDAR over time
CREATE TABLE calendar_entry (
  aid         INTEGER PRIMARY KEY,
  start_date  INTEGER NOT NULL,
  dateflags   INTEGER,
  first_seen  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_calendar_start ON calendar_entry(start_date);

-- Daily anime-titles.xml.gz dump → fuels search before any UDP fetch
CREATE TABLE titles_dump (
  aid    INTEGER NOT NULL,
  lang   TEXT NOT NULL,
  type   TEXT NOT NULL,
  title  TEXT NOT NULL,
  PRIMARY KEY (aid, lang, type, title)
);

CREATE VIRTUAL TABLE titles_fts USING fts5(
  title,
  aid UNINDEXED,
  lang UNINDEXED,
  type UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Job queue
CREATE TABLE job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,
  params_json   TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 10,    -- lower = more urgent
  status        TEXT NOT NULL DEFAULT 'pending',-- pending|running|done|failed
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX idx_job_status_priority ON job(status, priority, created_at);

-- Generic key/value (schema version, session token, last-sync timestamps, etc.)
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
