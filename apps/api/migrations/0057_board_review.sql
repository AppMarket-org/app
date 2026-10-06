-- #260: the agent board can open a pull request for a finished task instead of merging it
-- (review_agent_work), and a pull request remembers the board task it came from.
ALTER TABLE repo_pull_settings ADD COLUMN review_agent_work INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pull_requests ADD COLUMN task_id TEXT;
