-- #198: a note can be published with the app (off by default; shown on the app page when the
-- repo is public, and copied to forks of it).
ALTER TABLE memory_notes ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
