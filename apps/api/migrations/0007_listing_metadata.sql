-- PRD R24 metadata and R26 runtime.
ALTER TABLE listings ADD COLUMN runtime TEXT NOT NULL DEFAULT 'workers-js'
  CHECK (runtime IN ('workers-js', 'static', 'workers-python', 'workers-rust', 'container'));
-- JSON array of target platforms.
ALTER TABLE listings ADD COLUMN platforms TEXT NOT NULL DEFAULT '["workers"]';
ALTER TABLE listings ADD COLUMN license TEXT;
ALTER TABLE listings ADD COLUMN submitted_notes TEXT;
CREATE INDEX listings_runtime_state_idx ON listings (runtime, state);

-- One row per published version; the changelog.
CREATE TABLE listing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  tag TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  release_notes TEXT NOT NULL DEFAULT '',
  published_by TEXT NOT NULL REFERENCES "user"(id),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX listing_versions_listing_idx ON listing_versions (listing_id, id DESC);

-- Screenshots; image bytes live in the R2 MEDIA bucket under r2_key.
CREATE TABLE listing_screenshots (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX listing_screenshots_listing_idx ON listing_screenshots (listing_id, position);
