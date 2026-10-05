-- #68 (G3): the versioned conformance rules (mirrored from the code's RULESET) and the results
-- per repo and commit. The security-scan rule is read live from repo_checks (#27).
CREATE TABLE conformance_rules (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL, -- error | warning | info
  PRIMARY KEY (id, version)
);
CREATE TABLE conformance_results (
  repo_id TEXT NOT NULL REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  ruleset_version INTEGER NOT NULL,
  results TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (repo_id, commit_sha, ruleset_version)
);
