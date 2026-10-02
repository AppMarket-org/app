# Deploying appmarket.org (R22)

Deploys run from GitHub Actions (`.github/workflows/deploy.yml`), manually, one environment at a time:
**Actions → Deploy → Run workflow → staging | production**. Each run waits for approval on its
GitHub environment, then checks, migrates D1, deploys the API Worker (`cf deploy --mode <env>`),
deploys the web Worker (Wrangler) and smoke-tests `/api/health`.

Staging first. Production only after staging has been checked and the owner approves.

Nothing below is done automatically. Each step changes the Cloudflare account or GitHub repo
settings, so it needs the owner.

## One-time setup per environment

Replace `<env>` with `staging` or `prod` (resource names) and `<mode>` with `staging` or `production`.

### 1. Cloudflare resources

```sh
cf d1 create --name appmarket-<env>                 # copy the ID into apps/api/environments.ts → database.id
cf r2 buckets create --name appmarket-media-<env>
cf r2 buckets create --name appmarket-releases-<env>
cf r2 buckets create --name appmarket-builds-<env>  # D6 build snapshots; add a lifecycle rule expiring backups/ after 7 days
```

Artifacts namespaces (`staging`, `prod`) are created on first use by the binding.

### 2. Cloudflare Access on /admin

Zero Trust → Access → Applications → Self-hosted, for `staging.appmarket.org` (or `appmarket.org`)
with paths `/admin` and `/api/admin`. Policy: allow the owner's email (and other admins). Then set
in `apps/api/environments.ts` → `access`:

- `teamDomain`: `<team>.cloudflareaccess.com`
- `aud`: the application's **Application Audience (AUD) Tag**

Until both are set, the deployed API refuses `/api/admin/*` (503), and the deploy preflight fails.
The API also verifies Access's JWT on those routes (`src/auth/access.ts`).

### 3. Sign-in and other providers

- Google and GitHub OAuth apps with callback `https://<host>/api/auth/callback/{google,github}`.
- Turnstile widget for `staging.appmarket.org` and `appmarket.org`; put the site key in
  `apps/web/src/environments/environment.production.ts`.
- Cloudflare OAuth client (D5) with redirect `https://<host>/api/cloudflare/callback`. Set its scopes
  through the API (the dashboard cannot add `workers-scripts.write`); see `docs/cloudflare-deploy.md`.
- R2 API token scoped to `appmarket-builds-<env>` (Object Read & Write) for D6 build containers.

### 4. Worker secrets

Set once per environment, from a terminal (values are read without echo and never stored in files):

```sh
cd apps/api
for name in BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET \
  TURNSTILE_SECRET_KEY DOWNLOAD_SIGNING_KEY CF_OAUTH_CLIENT_ID CF_OAUTH_CLIENT_SECRET CF_TOKEN_ENCRYPTION_KEY \
  R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  printf '%s: ' "$name"; read -rs V; echo
  cf workers secrets update "$name" --worker appmarket-api-<staging|> --text "$V"; unset V
done
```

`BETTER_AUTH_SECRET`, `DOWNLOAD_SIGNING_KEY` and `CF_TOKEN_ENCRYPTION_KEY` are random
(`openssl rand -base64 32`) and must differ between staging and production. The Worker has to exist
before secrets can be set: the first deploy creates it, and endpoints that need a missing secret fail
until it is set.

### 5. GitHub

Settings → Environments → create `staging` and `production`:

- **Required reviewers**: the owner (this is the approval gate for every deploy).
- **Deployment branches**: `main` only.
- Secret `CLOUDFLARE_API_TOKEN`: an API token for this account with Workers Scripts Edit, Workers
  Routes Edit, D1 Edit, Workers R2 Storage Edit, Containers Edit, Artifacts Edit, Zone → Workers
  Routes Edit and DNS Edit for `appmarket.org` (custom domains).
- Variable `CLOUDFLARE_ACCOUNT_ID`: `aada0f21d612f647ef27d21e1c09b648`.

## Before the first production deploy

- Legal pages: fill placeholders and get counsel review; remove the draft banner (#19).
- Containers are billed by usage (D6 builds, standard-1, at most 5 at a time).
- After deploy: verify the domain in Google Search Console and submit `/sitemap.xml` (#45).

## Rollback

```sh
cf workers deployments list --worker appmarket-api-staging   # or appmarket-api
npx wrangler rollback --name appmarket-web-staging            # web Worker, previous version
```

D1 migrations are forward-only; write a new migration to undo one.
