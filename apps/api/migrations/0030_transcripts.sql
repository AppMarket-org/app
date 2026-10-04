-- #129: the full record of a checkpoint that was too large to store inline, encrypted in R2
-- (transcripts/<repo>/<commit>) with a key derived per account. D1 keeps only the reference.
ALTER TABLE checkpoints ADD COLUMN transcript_ref TEXT;
ALTER TABLE checkpoints ADD COLUMN transcript_bytes INTEGER;
