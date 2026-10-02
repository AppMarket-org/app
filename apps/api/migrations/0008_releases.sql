-- PRD R5/R13/R14: release binaries (bytes in the R2 RELEASES bucket) and download counts.
CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  tag TEXT NOT NULL,
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (listing_id, tag, platform, filename)
);
CREATE INDEX releases_listing_tag_idx ON releases (listing_id, tag);
