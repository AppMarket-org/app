-- #42 (R17): paid apps. Stripe Connect Express accounts per owner (user or org), purchases
-- (which are the entitlements while paid) and encrypted platform secrets such as the webhook
-- endpoint's signing secret.
CREATE TABLE stripe_accounts (
  owner_id TEXT PRIMARY KEY REFERENCES owners(id),
  account_id TEXT NOT NULL UNIQUE,
  country TEXT,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  -- Destination charges need the transfers capability to be active.
  transfers_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  checkout_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  -- paid (owns the app) | refunded | disputed
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX purchases_buyer ON purchases(user_id, repo_id);
CREATE INDEX purchases_repo ON purchases(repo_id, created_at DESC);
CREATE INDEX purchases_payment ON purchases(payment_intent_id);
CREATE TABLE app_secrets (
  name TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
