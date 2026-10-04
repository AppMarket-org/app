-- #29 (R9): agent sessions. Each session works in its own fork with a short-lived write token, so an
-- agent can never push to the repo it started from.
ALTER TABLE repos ADD COLUMN session_of TEXT REFERENCES repos(id);
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  fork_repo_id TEXT NOT NULL REFERENCES repos(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  -- claude-code, codex, cursor, opencode or other.
  harness TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | ended | discarded
  token_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT
);
CREATE INDEX agent_sessions_repo ON agent_sessions(repo_id, created_at DESC);
