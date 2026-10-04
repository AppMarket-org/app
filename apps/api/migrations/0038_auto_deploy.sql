-- #37 (D7): redeploy the default branch on every push, into the same account as previews.
ALTER TABLE repo_preview_settings ADD COLUMN deploy_default INTEGER NOT NULL DEFAULT 0;
-- Worker the default branch deploys to (e.g. the one the buyer already deployed the original app as).
ALTER TABLE repo_preview_settings ADD COLUMN worker_name TEXT;
