-- #146: profile privacy. private_contributions adds contributions in unpublished repos to the
-- graph as anonymous counts (off by default); hide_activity and hide_location remove those
-- sections from the profile and the API.
ALTER TABLE owners ADD COLUMN private_contributions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN hide_activity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN hide_location INTEGER NOT NULL DEFAULT 0;
