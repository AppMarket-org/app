-- PRD R18: reports from visitors about listings (abuse, DMCA, malware), handled by admins.
CREATE TABLE listing_reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  contact TEXT,
  reporter_id TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES "user"(id),
  resolution TEXT
);
CREATE INDEX listing_reports_open_idx ON listing_reports (resolved_at, created_at);
