-- #192: a preview Worker the developer deleted. The row stays (with its commit), so the minute
-- scan does not redeploy the same commit; a new push to the branch brings the preview back.
ALTER TABLE deployments ADD COLUMN deleted_at TEXT;
