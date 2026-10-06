-- #308: branch rules for agent sessions at the Git endpoint.
-- Branches the owner protects beyond the default branch (JSON list of names or "prefix/*").
ALTER TABLE repo_pull_settings ADD COLUMN protected_branches TEXT NOT NULL DEFAULT '[]';
-- #309: an agent session working in the repo pushes with its own appmarket.org sign-in.
ALTER TABLE agent_sessions ADD COLUMN auth_session_id TEXT;
CREATE INDEX agent_sessions_auth ON agent_sessions(auth_session_id) WHERE auth_session_id IS NOT NULL;
-- Branches a session created (it may delete those, and only those).
CREATE TABLE agent_session_branches (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, branch)
);
