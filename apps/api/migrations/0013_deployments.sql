-- PRD D6: one-click deploys into a buyer's Cloudflare account. The Workflow instance id is the row id.
-- secrets_enc holds the buyer's secret values (encrypted) only until the deploy finishes.
CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  version_tag TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  account_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  deploy_config TEXT NOT NULL,
  secrets_enc TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX deployments_user ON deployments(user_id, created_at DESC);
