-- #294: issues. Numbered per repo together with pull requests (one counter, so #N is either an
-- issue or a pull request), starting after the repo's last pull request.
CREATE TABLE repo_numbers (
  repo_id TEXT PRIMARY KEY REFERENCES repos(id),
  last INTEGER NOT NULL
);
INSERT INTO repo_numbers (repo_id, last) SELECT repo_id, MAX(number) FROM pull_requests GROUP BY repo_id;

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- bug | feature | task
  type TEXT NOT NULL DEFAULT 'task',
  -- none | low | medium | high | urgent
  priority TEXT NOT NULL DEFAULT 'none',
  -- A person, or (for_agents = 1) any agent on the repo's board; never both.
  assignee_id TEXT REFERENCES "user"(id),
  for_agents INTEGER NOT NULL DEFAULT 0,
  -- open | closed; reason: completed | not_planned
  state TEXT NOT NULL DEFAULT 'open',
  reason TEXT,
  author_id TEXT NOT NULL REFERENCES "user"(id),
  closed_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT,
  UNIQUE (repo_id, number)
);
CREATE INDEX issues_repo ON issues(repo_id, state, number DESC);
CREATE INDEX issues_assignee ON issues(assignee_id, state) WHERE assignee_id IS NOT NULL;
CREATE INDEX issues_agents ON issues(repo_id, state) WHERE for_agents = 1;

CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX issue_comments_issue ON issue_comments(issue_id, created_at);
