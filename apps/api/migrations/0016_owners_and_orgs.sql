-- #102: one namespace for users and organizations (GitHub-style handles), and repo names that are
-- unique per owner instead of site-wide. A user's owner row reuses the user's id, so existing
-- repos.owner_id values stay valid.
CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'org')),
  -- Set for kind = 'user' (equal to id).
  user_id TEXT UNIQUE REFERENCES "user"(id),
  -- Display name for organizations; users show their profile name.
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES owners(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON org_members (user_id);

-- Existing users: handle from the part of the email before @, hyphenated, numbered on clashes.
-- Users can change it in Settings.
INSERT INTO owners (id, handle, kind, user_id, created_at)
WITH base AS (
  SELECT id, createdAt,
    trim(replace(replace(replace(replace(lower(substr(email, 1, instr(email, '@') - 1)), '.', '-'), '_', '-'), '+', '-'), '--', '-'), '-') AS h
  FROM "user"
), safe AS (
  SELECT id, createdAt,
    CASE WHEN h = '' OR h IN ('about', 'admin', 'api', 'apps', 'brand', 'dashboard', 'docs', 'explore', 'help', 'legal', 'login', 'logout', 'new', 'orgs', 'organizations', 'search', 'settings', 'sitemaps', 'support', 'www')
      THEN 'user' ELSE substr(h, 1, 32) END AS h
  FROM base
), numbered AS (
  SELECT id, h, ROW_NUMBER() OVER (PARTITION BY h ORDER BY createdAt, id) AS n FROM safe
)
SELECT id, CASE WHEN n = 1 THEN h ELSE h || '-' || n END, 'user', id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM numbered;

-- Rebuild repos: owner_id now points at owners (a user or an org), created_by records who created
-- it, and the name (slug) is unique per owner.
CREATE TABLE repos_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'published', 'unpublished', 'removed')),
  git_repo TEXT UNIQUE,
  published_tag TEXT,
  approved_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_tag TEXT,
  submitted_commit TEXT,
  published_commit TEXT,
  runtime TEXT NOT NULL DEFAULT 'workers-js' CHECK (runtime IN ('workers-js', 'static', 'workers-python', 'workers-rust', 'container')),
  platforms TEXT NOT NULL DEFAULT '["workers"]',
  license TEXT,
  submitted_notes TEXT,
  submitted_checks TEXT,
  published_manifest TEXT,
  published_repo_map TEXT,
  cowbell_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner_id, slug)
);

INSERT INTO repos_new (id, owner_id, created_by, slug, name, summary, description, category, price_cents, state, git_repo, published_tag, approved_by, created_at, updated_at, submitted_tag, submitted_commit, published_commit, runtime, platforms, license, submitted_notes, submitted_checks, published_manifest, published_repo_map, cowbell_count)
SELECT id, owner_id, owner_id, slug, name, summary, description, category, price_cents, state, git_repo, published_tag, approved_by, created_at, updated_at, submitted_tag, submitted_commit, published_commit, runtime, platforms, license, submitted_notes, submitted_checks, published_manifest, published_repo_map, cowbell_count
FROM repos;

-- Tables that reference repos are emptied while it is replaced and refilled after, so no
-- foreign key is ever broken (D1 checks them).
CREATE TABLE _keep_repo_events AS SELECT * FROM repo_events;
DELETE FROM repo_events;
CREATE TABLE _keep_repo_versions AS SELECT * FROM repo_versions;
DELETE FROM repo_versions;
CREATE TABLE _keep_repo_screenshots AS SELECT * FROM repo_screenshots;
DELETE FROM repo_screenshots;
CREATE TABLE _keep_repo_reports AS SELECT * FROM repo_reports;
DELETE FROM repo_reports;
CREATE TABLE _keep_releases AS SELECT * FROM releases;
DELETE FROM releases;
CREATE TABLE _keep_token_audit AS SELECT * FROM token_audit;
DELETE FROM token_audit;
CREATE TABLE _keep_deployments AS SELECT * FROM deployments;
DELETE FROM deployments;
CREATE TABLE _keep_cowbells AS SELECT * FROM cowbells;
DELETE FROM cowbells;

DROP TABLE repos;
ALTER TABLE repos_new RENAME TO repos;

INSERT INTO repo_events SELECT * FROM _keep_repo_events;
DROP TABLE _keep_repo_events;
INSERT INTO repo_versions SELECT * FROM _keep_repo_versions;
DROP TABLE _keep_repo_versions;
INSERT INTO repo_screenshots SELECT * FROM _keep_repo_screenshots;
DROP TABLE _keep_repo_screenshots;
INSERT INTO repo_reports SELECT * FROM _keep_repo_reports;
DROP TABLE _keep_repo_reports;
INSERT INTO releases SELECT * FROM _keep_releases;
DROP TABLE _keep_releases;
INSERT INTO token_audit SELECT * FROM _keep_token_audit;
DROP TABLE _keep_token_audit;
INSERT INTO deployments SELECT * FROM _keep_deployments;
DROP TABLE _keep_deployments;
INSERT INTO cowbells SELECT * FROM _keep_cowbells;
DROP TABLE _keep_cowbells;

CREATE INDEX repos_submitted_idx ON repos (state) WHERE state = 'submitted';
CREATE INDEX repos_state_updated_idx ON repos (state, updated_at DESC);
CREATE INDEX repos_category_state_idx ON repos (category, state);
CREATE INDEX repos_owner_idx ON repos (owner_id);
CREATE INDEX repos_runtime_state_idx ON repos (runtime, state);
CREATE INDEX repos_state_cowbells_idx ON repos (state, cowbell_count DESC);
CREATE INDEX repos_created_by_idx ON repos (created_by);
