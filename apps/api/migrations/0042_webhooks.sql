-- #34: push webhooks. The minute cron compares each webhook's last seen refs with the repo's and
-- delivers one event per new or moved branch or tag.
CREATE TABLE repo_webhooks (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  url TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'generic', -- generic | github
  -- HMAC signing secret (generic) and the developer's GitHub token (github), both encrypted.
  secret_enc TEXT NOT NULL,
  github_token_enc TEXT,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  refs TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX repo_webhooks_repo ON repo_webhooks(repo_id);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES repo_webhooks(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  status INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
