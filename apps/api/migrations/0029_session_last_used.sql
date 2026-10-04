-- #133: when a session (browser or device) was last used, and from which network: the client
-- IP cut to its /24 (IPv4) or /48 (IPv6) prefix, never the full address.
ALTER TABLE "session" ADD COLUMN lastUsedAt TEXT;
ALTER TABLE "session" ADD COLUMN lastIpPrefix TEXT;
