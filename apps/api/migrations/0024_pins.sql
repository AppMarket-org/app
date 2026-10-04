-- #142: up to six repos pinned on a profile, in order. Only published repos are shown, so a
-- hidden or removed repo drops off on its own; deleting it removes the pin.
CREATE TABLE owner_pins (
  owner_id TEXT NOT NULL REFERENCES owners(id),
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner_id, repo_id)
);
