-- #128: secrets the API redacted itself (the CLI missed them), for the developer notice.
ALTER TABLE checkpoints ADD COLUMN server_redactions INTEGER NOT NULL DEFAULT 0;
