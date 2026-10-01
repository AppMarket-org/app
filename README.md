# appmarket.org

A marketplace for apps whose source lives in Cloudflare Artifacts and deploys into the buyer's own Cloudflare account.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | appmarket.org Worker: API, storefront, developer dashboard, admin (`cf` project) |
| `packages/shared` | Shared types: listing lifecycle, roles, platforms |
| `packages/template-contract` | Submit-time template lint and deploy manifest (D2, D3) |
| `db/migrations` | D1 schema |
| `docs` | PRD link, Phase 0 setup, ADRs |
| `scripts` | Repo checks (no secrets in Git) |

## Develop

Node 22.18+, pnpm.

```sh
pnpm install
pnpm typecheck
pnpm dev
```

Roadmap: GitHub milestones Phase 0 to Phase 3. See [docs](docs/README.md).
