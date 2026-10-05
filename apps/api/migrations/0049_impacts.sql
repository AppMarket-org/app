-- #69 (G2): impacts. An admin files a vulnerable package (with the affected version range) or a
-- conformance rule; every repo that carries it (forks included, via the #67 graph or #68
-- results) is listed and its owners see a dashboard notice. The minute cron keeps the list current.
CREATE TABLE impacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- package | rule
  target TEXT NOT NULL, -- package name or rule id
  affected TEXT, -- semver range of vulnerable versions (packages)
  title TEXT NOT NULL,
  guidance TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  checked_at TEXT,
  closed_at TEXT
);
CREATE TABLE impact_repos (
  impact_id TEXT NOT NULL REFERENCES impacts(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  detail TEXT, -- declared range, or the failing rule's details
  found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  PRIMARY KEY (impact_id, repo_id)
);
CREATE INDEX impact_repos_repo ON impact_repos(repo_id) WHERE resolved_at IS NULL;
