-- PRD R19: record revocations alongside mints.
ALTER TABLE token_audit ADD COLUMN revoked_at TEXT;
ALTER TABLE token_audit ADD COLUMN revoked_by TEXT REFERENCES "user"(id);
CREATE INDEX token_audit_listing_idx ON token_audit (listing_id, id);
