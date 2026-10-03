-- Checkpoints PRD (#111): one checkpoint per commit, keyed by (repo, commit). `record` is the JSON
-- the CLI uploaded (already redacted on the machine); the other columns index it.
CREATE TABLE checkpoints (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  record TEXT NOT NULL,
  -- SHA-256 of the record, so an identical retry is a no-op (200) and a different one a conflict (409).
  record_hash TEXT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('harness', 'agent-reported')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'attached', 'missing')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'listing', 'public')),
  uploaded_by TEXT REFERENCES "user"(id),
  -- Device name at upload (device login), for the timeline.
  device TEXT,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (repo_id, commit_sha)
);
CREATE INDEX checkpoints_repo_received_idx ON checkpoints (repo_id, received_at DESC);
CREATE INDEX checkpoints_repo_session_idx ON checkpoints (repo_id, session_id);

-- Default visibility for new checkpoints on a repo (private unless the owner opts in).
ALTER TABLE repos ADD COLUMN checkpoint_visibility TEXT NOT NULL DEFAULT 'private' CHECK (checkpoint_visibility IN ('private', 'listing', 'public'));
