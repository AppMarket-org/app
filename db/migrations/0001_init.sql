-- Phase 1 catalog schema draft (PRD R1, R11, R12, R19, R24). Applied when the D1 binding is added.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('developer', 'buyer', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'submitted', 'published', 'unpublished', 'removed')),
  repo_name TEXT NOT NULL UNIQUE,
  published_tag TEXT,
  approved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE token_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
