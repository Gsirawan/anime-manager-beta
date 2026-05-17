-- 004: store the AniDB mylist entry id (lid) per local row.
-- Required for MYLISTEDIT / MYLISTDEL — without a lid AniDB can only target an
-- entry via file hash or composite anime+group+epno, neither of which we have
-- for a watchlist-only client.
ALTER TABLE mylist ADD COLUMN anidb_lid INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_mylist_anidb_lid ON mylist(anidb_lid);
