# ADR 0001: Cloudflare Artifacts for app source

**Status:** Accepted (2026-10-01)

**Decision:** App source lives in one Artifacts Git repository per repo. Catalog in D1, binaries in R2. Buyers deploy into their own Cloudflare account (PRD Path A in Phase 1, Path B in Phase 2).

**Consequences:** Requires Workers Paid; Artifacts billing starts 2026-10-14. Per-repo limit 1 GB, 32 MB per file.
