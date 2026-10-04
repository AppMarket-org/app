-- #124: the Artifacts lastPushAt the checkpoints were last reconciled against (pending → attached,
-- missing placeholders). NULL: never.
ALTER TABLE repos ADD COLUMN checkpoints_reconciled_at TEXT;
