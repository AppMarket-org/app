-- PRD R3/R19: keep the Artifacts token id (never the token) so a leaked token can be revoked.
ALTER TABLE token_audit ADD COLUMN token_id TEXT;
