# appmarket.org

A marketplace for apps whose source lives in Cloudflare Artifacts and deploys into the buyer's own Cloudflare account.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Angular 22 + Angular Material UI: server-rendered SEO pages and the signed-in SPA (Wrangler Worker) |
| `apps/api` | Hono API on Workers: Artifacts, D1, R2, auth (`cf` project) |
| `packages/shared` | Shared types: repo lifecycle, roles, platforms |
| `packages/template-contract` | Submit-time template lint and deploy manifest (D2, D3) |
| `db/migrations` | D1 schema |
| `docs` | PRD link, Phase 0 setup, ADRs |
| `scripts` | Repo checks (no secrets in Git) |

## Develop

Node 22.18+, pnpm.

```sh
pnpm install
pnpm typecheck
pnpm dev      # API on :5173, Angular on :4200 (proxies /api)
pnpm build    # Angular SSR build
```

First run: copy `apps/api/.dev.vars.example` to `.dev.vars` and run `pnpm --filter @appmarket/api db:migrate`. See [auth setup](docs/auth-setup.md).

Stack decisions: [ADR 0002](docs/adr/0002-stack-angular-hono-auth.md).

Roadmap: GitHub milestones Phase 0 to Phase 3. See [docs](docs/README.md).
