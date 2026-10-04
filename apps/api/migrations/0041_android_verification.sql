-- #33 (M2): APK downloads open only after the developer declares the app's package name and that
-- they completed Android developer verification for it (enforced on certified devices since
-- 30 Sep 2026 in BR, ID, SG and TH; globally in 2027).
ALTER TABLE repos ADD COLUMN android_package TEXT;
ALTER TABLE repos ADD COLUMN android_verified_at TEXT;
