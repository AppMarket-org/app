-- #26 (R6 "use this template"): a fork remembers its source repo and the published commit and
-- tag it was taken from (the fork's Artifacts repo is a native fork of the source's).
ALTER TABLE repos ADD COLUMN forked_from TEXT REFERENCES repos(id);
ALTER TABLE repos ADD COLUMN forked_commit TEXT;
ALTER TABLE repos ADD COLUMN forked_tag TEXT;
