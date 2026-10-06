-- #73 (G8): forks of a template can opt in to updates. When the template publishes a version,
-- each opted-in fork gets a pull request with it (one row per fork and version).
ALTER TABLE repo_pull_settings ADD COLUMN upstream_sync INTEGER NOT NULL DEFAULT 0;

CREATE TABLE upstream_syncs (
  id TEXT PRIMARY KEY,
  fork_id TEXT NOT NULL REFERENCES repos(id),
  upstream_id TEXT NOT NULL REFERENCES repos(id),
  tag TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  -- queued | current (the fork already has it) | opened | failed
  status TEXT NOT NULL DEFAULT 'queued',
  pull_id TEXT REFERENCES pull_requests(id),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (fork_id, tag)
);
CREATE INDEX upstream_syncs_upstream ON upstream_syncs(upstream_id, created_at DESC);
