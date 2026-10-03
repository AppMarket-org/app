# Deploying into buyers' Cloudflare accounts (Path B: D5, D6)

Buyers connect their Cloudflare account to appmarket.org with OAuth, then deploy a repo into it with one click. Decided 2026-10-02: Path B ships in Phase 1; no Deploy button, no GitHub mirror.

## 1. Register the OAuth client (owner, one time per environment)

Cloudflare dashboard → **Manage Account** → **OAuth clients** → **Create client** ([docs](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)):

| Field | Value |
| --- | --- |
| Client name | `appmarket.org` (add `(dev)` / `(staging)` for non-production clients) |
| Response type | `code` |
| Grant types | `authorization_code`, `refresh_token` |
| Token authentication method | `client_secret_basic` |
| Redirect URLs | dev: `http://localhost:4200/api/cloudflare/callback` · staging: `https://staging.appmarket.org/api/cloudflare/callback` · prod: `https://appmarket.org/api/cloudflare/callback` |
| Required scopes | `offline_access`, `user-details.read`, `account-settings.read`, `memberships.read`, `workers-scripts.write`, `d1.write`, `workers-kv-storage.write`, `workers-r2.write` |
| Optional scopes | `queues.write`, `vectorize.write`, `query-cache.write`, `containers.write`, `workers-observability.read` |

The list lives in `packages/shared/src/cloudflare.ts` (`CF_OAUTH_SCOPES`); scope IDs come from `cf oauth-scopes list`. The scopes requested must match the client exactly, or Cloudflare returns `invalid_scope`. Uploading Workers needs `workers-scripts.write`, which the dashboard's scope picker does not offer (its Workers → Edit is `workers-scripts.edit`, which gets 403 on uploads). Create the client in the dashboard, then set the scopes through the API with a short-lived API token that has Account → OAuth Clients: Edit:

```sh
read -rs T; curl -s -X PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  https://api.cloudflare.com/client/v4/accounts/<account_id>/oauth_clients/<client_id> \
  -d '{"scopes":[...required and optional...],"optional_scopes":[...optional...]}'; unset T
```

Hyperdrive is `query-cache.*`; `offline_access` is added automatically with the Refresh Token grant.

New clients are **private**: only members of your Cloudflare account can authorize them, which is enough for development and staging. To let any Cloudflare user connect (production), set a logo, client URL `https://appmarket.org`, verify the domain with the `cloudflare_oauth_client_publisher=` TXT record, then change visibility to public. **Public is permanent.**

Put the values in `apps/api/.dev.vars` (local) or `cf secrets` (deployed):

```
CF_OAUTH_CLIENT_ID=...
CF_OAUTH_CLIENT_SECRET=...
CF_TOKEN_ENCRYPTION_KEY=   # openssl rand -base64 32, different per environment
```

## 2. How the connection works (D5)

- `GET /api/cloudflare/connect` → Cloudflare consent page (Authorization Code + client secret + PKCE S256; one-time `state`, 10 minutes, bound to the appmarket user).
- `GET /api/cloudflare/callback` exchanges the code, reads the user's email, stores tokens **encrypted** (AES-256-GCM, key in `CF_TOKEN_ENCRYPTION_KEY`, user id as additional data).
- Access tokens refresh automatically when they are within a minute of expiry.
- `POST /api/cloudflare/disconnect` revokes both tokens at Cloudflare and deletes them.
- Dashboard: `/dashboard/cloudflare`.

## 3. Deploy (D6)

Built next: a deploy Worker running a `@cloudflare/ci` Workflow (install → build → `wrangler deploy` into the buyer's account). Buyer tokens are never put in Workflow parameters (those are persisted); the deploy step reads the token from the encrypted store when it runs.
