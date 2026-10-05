-- #238: merges of agent work from the collaboration plane (#236). One row per attempt: the agent's
-- branch in its session fork, rebased onto the repo's base branch, checked, then fast-forwarded.
CREATE TABLE plane_merges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  branch TEXT NOT NULL,
  base_branch TEXT,
  -- queued | rebasing | checking | merging | merged | conflict | failed
  status TEXT NOT NULL DEFAULT 'queued',
  base_sha TEXT,
  head_sha TEXT,
  checks_run_id TEXT,
  -- JSON: conflicting paths, or the checks and conformance rules that failed.
  details TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
CREATE INDEX plane_merges_repo ON plane_merges(repo_id, created_at DESC);
CREATE INDEX plane_merges_task ON plane_merges(task_id, created_at DESC);
