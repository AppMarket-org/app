-- Cowbells: appmarket's version of GitHub stars. One per user per repo; repos keep a count for
-- cards and "most cowbells" sorting, recomputed whenever someone rings or un-rings one.
CREATE TABLE cowbells (
  user_id TEXT NOT NULL REFERENCES "user"(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, repo_id)
);
CREATE INDEX cowbells_repo_idx ON cowbells (repo_id);
CREATE INDEX cowbells_user_idx ON cowbells (user_id, created_at DESC);

ALTER TABLE repos ADD COLUMN cowbell_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX repos_state_cowbells_idx ON repos (state, cowbell_count DESC);
