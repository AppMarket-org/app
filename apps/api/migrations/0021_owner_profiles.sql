-- #139: profile fields for users and organizations (bio doubles as an organization's description).
-- owners.name, already the organization display name, now also overrides a user's sign-in name.
ALTER TABLE owners ADD COLUMN bio TEXT;
ALTER TABLE owners ADD COLUMN location TEXT;
ALTER TABLE owners ADD COLUMN website TEXT;
