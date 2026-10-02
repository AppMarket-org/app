-- Listing lifecycle (PRD R12) and its history, used by moderation (R18).
ALTER TABLE listings ADD COLUMN submitted_tag TEXT;

CREATE TABLE listing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES "user"(id),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner', 'admin')),
  tag TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX listing_events_listing_idx ON listing_events (listing_id, id);
CREATE INDEX listings_submitted_idx ON listings (state) WHERE state = 'submitted';
