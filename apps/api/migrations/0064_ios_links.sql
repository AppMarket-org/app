-- #43 (M4): iOS apps are distributed by Apple; a repo links to its App Store page and/or a public
-- TestFlight invite.
ALTER TABLE repos ADD COLUMN ios_app_store_url TEXT;
ALTER TABLE repos ADD COLUMN ios_testflight_url TEXT;
