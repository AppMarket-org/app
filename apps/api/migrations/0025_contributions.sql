-- #143: one row per contribution, keyed by what it is, so re-pushes and re-runs never double
-- count. day is the UTC date. Kinds: commit (ref = SHA, author matched by verified email),
-- repo (ref = repo id), version (ref = submission event id), release (ref = release id),
-- checkpoint (ref = commit SHA). Private repos are stored too; profiles filter them (#146).
CREATE TABLE contributions (
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'repo', 'version', 'release', 'checkpoint')),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  ref TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  day TEXT NOT NULL,
  PRIMARY KEY (kind, repo_id, ref)
);
CREATE INDEX contributions_user_day_idx ON contributions (user_id, day);

-- The repo's Artifacts change marker (lastPushAt or updatedAt) the commit scan last read, and
-- when the scan last looked at the repo (round robin for the cron).
ALTER TABLE repos ADD COLUMN contributions_scanned_at TEXT;
ALTER TABLE repos ADD COLUMN contributions_checked_at TEXT;

-- Backfill everything but commits (those come from the scan).
INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day)
  SELECT 'repo', id, id, created_by, substr(created_at, 1, 10) FROM repos;
INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day)
  SELECT 'version', repo_id, CAST(id AS TEXT), actor_id, substr(created_at, 1, 10) FROM repo_events WHERE to_state = 'submitted' AND actor_role = 'owner';
INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day)
  SELECT 'release', repo_id, id, uploaded_by, substr(created_at, 1, 10) FROM releases;
INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day)
  SELECT 'checkpoint', repo_id, commit_sha, uploaded_by, substr(received_at, 1, 10) FROM checkpoints WHERE uploaded_by IS NOT NULL AND state != 'missing';
