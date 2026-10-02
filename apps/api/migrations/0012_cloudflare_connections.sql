-- PRD D5: a buyer's Cloudflare account connection (tokens encrypted at rest) and pending OAuth logins.
CREATE TABLE cloudflare_connections (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id),
  cf_email TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE cloudflare_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
