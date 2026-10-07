-- Repo A2A keys: let an outside agent or orchestrator post and follow tasks on one repo's board
-- over A2A without anyone's personal sign-in. Only the SHA-256 of a key is stored.
CREATE TABLE a2a_keys (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX a2a_keys_repo ON a2a_keys(repo_id, created_at DESC);
