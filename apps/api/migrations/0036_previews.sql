-- #28 (R8): branch previews, deployed into the developer's own Cloudflare account.
CREATE TABLE repo_preview_settings (
  repo_id TEXT PRIMARY KEY REFERENCES repos(id),
  -- Whose Cloudflare connection deploys the previews; only they can change the account.
  user_id TEXT NOT NULL REFERENCES "user"(id),
  account_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- When its branches were last compared. Artifacts' lastPushAt only tracks the default branch,
  -- so branches are listed each turn, least recently checked repos first.
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE deployments ADD COLUMN preview_branch TEXT;
CREATE INDEX deployments_previews ON deployments(repo_id, preview_branch, created_at DESC) WHERE preview_branch IS NOT NULL;
