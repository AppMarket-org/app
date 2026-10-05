-- #194 (Agent memory): short notes per repo that agents and people keep for the next session.
-- Owners and org members only; every change is kept in memory_history with who and which agent.
CREATE TABLE memory_notes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  text TEXT NOT NULL,
  -- JSON array of lowercase tags.
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  -- Who wrote it: a harness (claude-code, codex, ...) or 'web'; and the agent session, if any.
  source TEXT NOT NULL DEFAULT 'web',
  session_id TEXT,
  -- Secrets the server redacted from this note (the CLI redacts first).
  redactions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX memory_notes_repo ON memory_notes(repo_id, pinned DESC, updated_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE memory_history (
  note_id TEXT NOT NULL REFERENCES memory_notes(id),
  version INTEGER NOT NULL,
  action TEXT NOT NULL, -- create | update | delete
  text TEXT NOT NULL,
  tags TEXT NOT NULL,
  pinned INTEGER NOT NULL,
  changed_by TEXT NOT NULL REFERENCES "user"(id),
  source TEXT NOT NULL,
  session_id TEXT,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (note_id, version)
);
