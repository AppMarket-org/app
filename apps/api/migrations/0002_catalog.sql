-- Phase 1 catalog schema draft (PRD R1, R12, R19, R24). Users and sessions live in Better Auth's tables (0001).
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'submitted', 'published', 'unpublished', 'removed')),
  repo_name TEXT NOT NULL UNIQUE,
  published_tag TEXT,
  approved_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE token_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
