-- #51 (D13): who changed which variable or secret on a deployed Worker, and when. Never the value.
CREATE TABLE deployment_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  kind TEXT NOT NULL, -- var | secret
  name TEXT NOT NULL,
  action TEXT NOT NULL, -- set | delete
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX deployment_config_audit_deployment ON deployment_config_audit(deployment_id, created_at DESC);
