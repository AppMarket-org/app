# Deploying appmarket.org (R22)

Deploys run from GitHub Actions (`.github/workflows/deploy.yml`), manually, one environment at a time:
**Actions → Deploy → Run workflow → staging | production**. Each run uses its GitHub environment's
secrets, then checks, migrates D1, deploys the API Worker (`cf deploy --mode <env>`),
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
two variables on the GitHub environment (not in the repo, which is public):

```sh
gh variable set ACCESS_TEAM_DOMAIN --env <env> --body <team>.cloudflareaccess.com
gh variable set ACCESS_AUD --env <env> --body <the application's Application Audience (AUD) Tag>
```

A deploy from your own machine needs the same two values in its environment.

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

Worker secrets live in the GitHub environment (`staging`, `production`) and are uploaded with every
deploy (`scripts/secrets-file.mjs` → `cf deploy --secrets-file`). Change one by updating the GitHub
secret and redeploying. Don't set them with `cf`/`wrangler`: the next deploy would overwrite them.

```sh
R=AppMarket-org/app; E=staging
# Random keys, different per environment (never printed):
for n in BETTER_AUTH_SECRET DOWNLOAD_SIGNING_KEY CF_TOKEN_ENCRYPTION_KEY; do openssl rand -base64 32 | tr -d '\n' | gh secret set $n --env $E --repo $R; done
# Values from providers (prompts without echo):
gh secret set GOOGLE_CLIENT_ID --env $E --repo $R
gh secret set GOOGLE_CLIENT_SECRET --env $E --repo $R
gh secret set OAUTH_GITHUB_CLIENT_ID --env $E --repo $R      # GitHub reserves the GITHUB_ prefix
gh secret set OAUTH_GITHUB_CLIENT_SECRET --env $E --repo $R
gh secret set TURNSTILE_SECRET_KEY --env $E --repo $R
gh secret set CF_OAUTH_CLIENT_ID --env $E --repo $R
gh secret set CF_OAUTH_CLIENT_SECRET --env $E --repo $R
gh secret set R2_ACCESS_KEY_ID --env $E --repo $R
gh secret set R2_SECRET_ACCESS_KEY --env $E --repo $R
```

The three random keys are required; the deploy refuses to run without them. Any other secret that is
not set yet is deployed as `not-configured`, so its feature (that sign-in provider, Cloudflare
connect, deploy builds) stays off until the real value is set and you redeploy.

### 5. GitHub

Settings → Environments → create `staging` and `production`:

- **Deployment branches**: `main` only.
- Required reviewers need a paid GitHub plan for private repos (the org is on Free), so the approval
  gate is that only the owner starts a deploy (or explicitly approves one started for them).
- Secret `CLOUDFLARE_API_TOKEN`: a custom API token (My Profile → API Tokens), limited to this
  account (Account Resources: Include → the account, not All accounts):
  - Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Containers Edit, Artifacts Edit;
  - Zone `appmarket.org` (Zone Resources: Include → Specific zone): Workers Routes Edit and DNS Edit
    (custom domains). Workers Routes is a zone permission; there is no account-level one.
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
