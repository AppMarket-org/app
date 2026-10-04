-- #135: every time a moderator views private checkpoints (only through a report on the repo).
-- The developer sees these entries (time and report reason) on their checkpoints timeline.
CREATE TABLE checkpoint_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  admin_id TEXT NOT NULL REFERENCES "user"(id),
  report_id TEXT NOT NULL REFERENCES repo_reports(id),
  private_count INTEGER NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX checkpoint_access_log_repo_idx ON checkpoint_access_log (repo_id, viewed_at DESC);
