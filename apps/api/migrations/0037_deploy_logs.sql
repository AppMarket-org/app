-- #40 (D10): build and deploy output of each deploy (tail, secrets redacted).
ALTER TABLE deployments ADD COLUMN logs TEXT;
