-- #258: pull request comments (conversation and diff lines), reviews, the per-repo merge rule,
-- and a 'pulls' email topic.
CREATE TABLE pull_comments (
  id TEXT PRIMARY KEY,
  pull_id TEXT NOT NULL REFERENCES pull_requests(id),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  body TEXT NOT NULL,
  -- A line comment: the file, the line, and which side of the diff (old or new).
  path TEXT,
  line INTEGER,
  side TEXT,
  review_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX pull_comments_pull ON pull_comments(pull_id, created_at);
CREATE TABLE pull_reviews (
  id TEXT PRIMARY KEY,
  pull_id TEXT NOT NULL REFERENCES pull_requests(id),
  reviewer_id TEXT NOT NULL REFERENCES "user"(id),
  -- commented | approved | changes_requested
  state TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- The head the review was for (an approval of an older head still counts; it is shown as such).
  head_sha TEXT,
  -- 1 when the reviewer was an owner or member of the repo (and not the author): only those
  -- reviews decide whether the pull request is approved.
  counts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX pull_reviews_pull ON pull_reviews(pull_id, created_at);
CREATE TABLE repo_pull_settings (
  repo_id TEXT PRIMARY KEY REFERENCES repos(id),
  -- Merging needs an approval from an owner or member other than the author.
  require_approval INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE email_preferences ADD COLUMN pulls INTEGER NOT NULL DEFAULT 1;
