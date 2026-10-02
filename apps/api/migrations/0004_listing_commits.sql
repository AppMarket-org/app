-- PRD R2/R12: record the commit a tag pointed to when submitted, so moving the tag later
-- cannot change what was reviewed or what buyers get.
ALTER TABLE listings ADD COLUMN submitted_commit TEXT;
ALTER TABLE listings ADD COLUMN published_commit TEXT;
ALTER TABLE listing_events ADD COLUMN commit_hash TEXT;
