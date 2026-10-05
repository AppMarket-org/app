-- Push detection by commit: Artifacts no longer reports push times (lastPushAt and updatedAt stay
-- at creation), so the scan compares each repo's default-branch head with the last one it
-- processed. Pushes through appmarket.org's Git remote are processed right away as well.
ALTER TABLE repos ADD COLUMN contributions_head TEXT;
-- Same for checkpoint reconciliation (#124): the head it last reconciled.
ALTER TABLE repos ADD COLUMN checkpoints_reconciled_head TEXT;
