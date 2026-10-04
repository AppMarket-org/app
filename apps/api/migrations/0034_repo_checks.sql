-- #27 (R7): automated checks (lint, typecheck, tests, security) per pushed or submitted commit,
-- run in a Sandbox container by the ChecksWorkflow. A submitted version publishes only when the
-- checks of its commit passed.
CREATE TABLE repo_checks (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('push', 'submit')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'error')),
  -- JSON: [{ name, status: passed|failed|skipped, output }]
  results TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
CREATE INDEX repo_checks_repo_idx ON repo_checks (repo_id, created_at DESC);
CREATE INDEX repo_checks_commit_idx ON repo_checks (repo_id, commit_sha);
