-- #366: who can read a repo, separate from its marketplace state. Private: owner, org members and
-- admins. Public: anyone. Published repos are always public.
ALTER TABLE repos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
UPDATE repos SET visibility = 'public' WHERE state = 'published';
