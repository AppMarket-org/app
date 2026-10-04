-- #141: organization membership is private unless the member shows it on the org's profile
-- (and on their own), like GitHub.
ALTER TABLE org_members ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
