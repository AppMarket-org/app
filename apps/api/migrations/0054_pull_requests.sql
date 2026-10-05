-- #256: pull requests. A source branch (same repo, or a fork of it: forked_from or session_of)
-- proposed for a target branch; merged by the merge Workflow (#238), which now serves both board
-- tasks and pull requests. plane_merges becomes merges, with the source repo on each row.
CREATE TABLE merges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  -- The repo the branch lives in (the target repo itself, a fork, or a session's fork).
  source_repo_id TEXT NOT NULL REFERENCES repos(id),
  task_id TEXT,
  session_id TEXT REFERENCES agent_sessions(id),
  pull_id TEXT,
  branch TEXT NOT NULL,
  base_branch TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  base_sha TEXT,
  head_sha TEXT,
  checks_run_id TEXT,
  details TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
INSERT INTO merges (id, repo_id, source_repo_id, task_id, session_id, branch, base_branch, status, base_sha, head_sha, checks_run_id, details, error, created_at, finished_at)
  SELECT m.id, m.repo_id, s.fork_repo_id, m.task_id, m.session_id, m.branch, m.base_branch, m.status, m.base_sha, m.head_sha, m.checks_run_id, m.details, m.error, m.created_at, m.finished_at
  FROM plane_merges m JOIN agent_sessions s ON s.id = m.session_id;
DROP TABLE plane_merges;
CREATE INDEX merges_repo ON merges(repo_id, created_at DESC);
CREATE INDEX merges_task ON merges(task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX merges_pull ON merges(pull_id, created_at DESC) WHERE pull_id IS NOT NULL;

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL REFERENCES "user"(id),
  source_repo_id TEXT NOT NULL REFERENCES repos(id),
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  -- open | closed | merged
  state TEXT NOT NULL DEFAULT 'open',
  head_sha TEXT,
  merged_sha TEXT,
  merged_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT,
  UNIQUE (repo_id, number)
);
CREATE INDEX pull_requests_repo ON pull_requests(repo_id, state, number DESC);
CREATE INDEX pull_requests_source ON pull_requests(source_repo_id, source_branch) WHERE state = 'open';
