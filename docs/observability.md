# Observability (R23)

Both Workers send logs, traces and errors to **Workers Observability** (dashboard → Observability).
Configuration: `observability` in `apps/api/cloudflare.config.ts` and `apps/web/wrangler.jsonc`.

## What is recorded

- **Request logs.** One invocation log per request, with method, path, status and duration. Query
  strings are stripped (`redactQueryString`), because OAuth callbacks and download links carry codes
  and signatures.
- **Errors.** Unhandled API errors are caught by `src/observability/errors.ts`, which writes a redacted
  `request.error` line and returns a generic 500. Workers Observability groups exceptions as
  **Issues** (enabled on both Workers).
- **Traces.** API traces are sampled at 10%.
- **Events.** Each one is a JSON log line with a stable `event` name (`src/observability/log.ts`).

| Event | When | Fields |
| --- | --- | --- |
| `repo.created` | Listing created with its Artifacts repo (R2) | `listing`, `repo`, `user` |
| `token.minted` | Repo token issued (R3) | `listing`, `scope`, `ttl`, `user`, `auditId` |
| `listing.transition` | Submit, publish, unpublish, remove (R5) | `listing`, `from`, `to`, `actor` |
| `download.link_issued` | Signed download link issued (R14) | `listing`, `release` |
| `download.started` | Release download started, once per file (R14) | `release`, `platform`, `size` |
| `deploy.started` / `deploy.succeeded` / `deploy.failed` | One-click deploy (D6) | `deployment`, `listing`, `version`, `user`, `error` |
| `repo_map.failed`, `cloudflare.token_request_failed`, `request.error` | Failures | context, `error` |

## Redaction

`logEvent` redacts before writing. Fields named like `token`, `secret`, `password`, `authorization`,
`cookie`, `code`, `state` or `sig` become `[redacted]`. Artifacts tokens (`art_v…`), bearer
credentials, JWTs and URLs carrying `token`/`sig`/`code`/`state` are removed from all text,
including error messages and stacks. Tests: `src/observability/*.test.ts`.

Never pass a token, secret value or email address to `logEvent` or `console.*`. Use ids.

## Dashboards (after the first deploy)

In Observability → Dashboards, create **appmarket** with these panels. Each one is a query on
`$workers.scriptName = appmarket-api[-staging]`.

- **Repos created / tokens minted / downloads / deploys:** count, filtered on `event` (one series
  per event above), grouped by time.
- **Deploy success rate:** `deploy.succeeded` vs `deploy.failed`.
- **API errors:** count of `$metadata.level = error`, grouped by `event` and `path`.
- **Latency:** P50/P95 wall time of invocations, grouped by `$workers.event.request.path`.

Turn on notifications for new Issues (Observability → Issues) so errors reach the owner.

## Retention

Workers Observability keeps logs for a limited period (7 days on Workers Paid). For longer
retention, add a Logpush job (`workers_trace_events`) to an R2 bucket. That is an account change
for the owner, done after launch if needed.
