-- Catalog (PRD R1, R12, R19, R24). Users and sessions live in Better Auth's tables (0001).
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'published', 'unpublished', 'removed')),
  -- Set when the Artifacts repo is created (R2).
  repo_name TEXT UNIQUE,
  published_tag TEXT,
  approved_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX listings_state_updated_idx ON listings (state, updated_at DESC);
CREATE INDEX listings_category_state_idx ON listings (category, state);
CREATE INDEX listings_owner_idx ON listings (owner_id);

CREATE TABLE token_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
