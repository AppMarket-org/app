-- #230: notification email (Cloudflare Email Service). Each affected repo of an impact is emailed
-- once; existing ones are marked as sent so turning email on does not send a backlog.
ALTER TABLE impact_repos ADD COLUMN emailed_at TEXT;
UPDATE impact_repos SET emailed_at = found_at;
CREATE TABLE email_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id),
  -- Impacts (security notices and rule changes) on repos the user owns.
  impacts INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
