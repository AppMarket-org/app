-- #30 (R10): where a repo's code was imported from (public GitHub URL and branch), for display.
ALTER TABLE repos ADD COLUMN imported_from TEXT;
