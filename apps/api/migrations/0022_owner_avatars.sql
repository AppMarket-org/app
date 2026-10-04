-- #140: uploaded profile pictures (users) and logos (organizations). Bytes in R2 under
-- avatars/<owner id>/<avatar id>; a new upload gets a new id, so the URL can be cached forever.
ALTER TABLE owners ADD COLUMN avatar_id TEXT;
ALTER TABLE owners ADD COLUMN avatar_type TEXT;
