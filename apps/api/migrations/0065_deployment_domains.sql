-- The Worker's custom domains in the buyer's account (JSON array of hostnames), refreshed whenever
-- appmarket.org lists, attaches or detaches them. The app's address is then the custom domain, not
-- workers.dev. A cache: domains changed in the Cloudflare dashboard show up on the next refresh.
ALTER TABLE deployments ADD COLUMN domains TEXT;
