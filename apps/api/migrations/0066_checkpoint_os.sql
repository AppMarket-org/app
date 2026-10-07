-- The operating system a checkpoint was uploaded from (from the CLI's user agent), shown instead
-- of the device's name.
ALTER TABLE checkpoints ADD COLUMN os TEXT;
