-- #170: bytes per language in the published version (JSON object), computed when a version is
-- published; NULL until then (the cron backfills published repos).
ALTER TABLE repos ADD COLUMN published_languages TEXT;
