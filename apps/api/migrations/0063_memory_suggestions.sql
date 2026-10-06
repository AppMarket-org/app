-- #197: notes suggested from checkpoints; a person accepts (it becomes a note linked back to its
-- checkpoint) or dismisses each one. Nothing is saved to memory without them.
CREATE TABLE memory_suggestions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  -- pending | accepted | dismissed
  status TEXT NOT NULL DEFAULT 'pending',
  note_id TEXT REFERENCES memory_notes(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  UNIQUE (repo_id, text)
);
CREATE INDEX memory_suggestions_repo ON memory_suggestions(repo_id, status, created_at DESC);
CREATE INDEX memory_suggestions_commit ON memory_suggestions(repo_id, commit_sha);
ALTER TABLE memory_notes ADD COLUMN checkpoint_sha TEXT;
