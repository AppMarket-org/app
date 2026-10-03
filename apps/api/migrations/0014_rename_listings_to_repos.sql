-- What a developer creates is a "repo" (owner decision 2026-10-03), not a "listing". The column that
-- named its Artifacts Git repository becomes git_repo so "repo" has one meaning.
-- Earlier migrations keep the old names: they have already run on every database.
ALTER TABLE listings RENAME TO repos;
ALTER TABLE repos RENAME COLUMN repo_name TO git_repo;

ALTER TABLE listing_events RENAME TO repo_events;
ALTER TABLE repo_events RENAME COLUMN listing_id TO repo_id;
ALTER TABLE listing_versions RENAME TO repo_versions;
ALTER TABLE repo_versions RENAME COLUMN listing_id TO repo_id;
ALTER TABLE listing_screenshots RENAME TO repo_screenshots;
ALTER TABLE repo_screenshots RENAME COLUMN listing_id TO repo_id;
ALTER TABLE listing_reports RENAME TO repo_reports;
ALTER TABLE repo_reports RENAME COLUMN listing_id TO repo_id;
ALTER TABLE releases RENAME COLUMN listing_id TO repo_id;
ALTER TABLE token_audit RENAME COLUMN listing_id TO repo_id;
ALTER TABLE deployments RENAME COLUMN listing_id TO repo_id;

DROP INDEX listings_submitted_idx;
DROP INDEX listings_state_updated_idx;
DROP INDEX listings_category_state_idx;
DROP INDEX listings_owner_idx;
DROP INDEX listings_runtime_state_idx;
DROP INDEX listing_events_listing_idx;
DROP INDEX listing_versions_listing_idx;
DROP INDEX listing_screenshots_listing_idx;
DROP INDEX listing_reports_open_idx;
DROP INDEX releases_listing_tag_idx;
DROP INDEX token_audit_listing_idx;

CREATE INDEX repos_submitted_idx ON repos (state) WHERE state = 'submitted';
CREATE INDEX repos_state_updated_idx ON repos (state, updated_at DESC);
CREATE INDEX repos_category_state_idx ON repos (category, state);
CREATE INDEX repos_owner_idx ON repos (owner_id);
CREATE INDEX repos_runtime_state_idx ON repos (runtime, state);
CREATE INDEX repo_events_repo_idx ON repo_events (repo_id, id);
CREATE INDEX repo_versions_repo_idx ON repo_versions (repo_id, id DESC);
CREATE INDEX repo_screenshots_repo_idx ON repo_screenshots (repo_id, position);
CREATE INDEX repo_reports_open_idx ON repo_reports (resolved_at, created_at);
CREATE INDEX releases_repo_tag_idx ON releases (repo_id, tag);
CREATE INDEX token_audit_repo_idx ON token_audit (repo_id, id);
