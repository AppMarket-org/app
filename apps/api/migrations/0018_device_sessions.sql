-- #107: sessions created by device login carry the client, granted scopes and a device name.
-- Browser sessions leave them NULL (full access).
ALTER TABLE "session" ADD COLUMN clientId TEXT;
ALTER TABLE "session" ADD COLUMN scopes TEXT;
ALTER TABLE "session" ADD COLUMN deviceName TEXT;
