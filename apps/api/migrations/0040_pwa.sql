-- #32 (M1): a live demo URL for the app (also where it installs as a web app), and the
-- installability check of the published version.
ALTER TABLE repos ADD COLUMN demo_url TEXT;
ALTER TABLE repos ADD COLUMN published_pwa TEXT;
