# Phase 0: first Artifacts repository

Local only. No deploy, no billing changes. Re-read https://developers.cloudflare.com/artifacts/llms.txt and https://developers.cloudflare.com/cf/llms.txt first.

1. Node 22.18+; `pnpm install` (installs `cf` locally).
2. `cf auth login` (install globally with `npm i -g cf`), then `cf auth whoami`. Pin `CLOUDFLARE_ACCOUNT_ID` if you have several accounts.
3. Confirm the account is on Workers Paid (Artifacts is Paid-only). If not, stop.
4. `pnpm --filter @appmarket/api dev` (API on port 5173). The `ARTIFACTS` binding uses `dev: { remote: true }`, so repos are created on Cloudflare.
5. Create the repo and keep the token in shell variables only:

```sh
RESPONSE=$(curl -s http://localhost:5173/api/repos -H 'Content-Type: application/json' -d '{"name":"appmarket-first-repo"}')
export ARTIFACTS_REMOTE=$(printf '%s' "$RESPONSE" | jq -r .remote)
export ARTIFACTS_TOKEN=$(printf '%s' "$RESPONSE" | jq -r .token)
unset RESPONSE
```

6. Push a README from a separate folder, then clone into another:

```sh
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push -u origin main
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" clone "$ARTIFACTS_REMOTE" verify-clone
```

7. Compare `git log -1` hashes, run `pnpm check:secrets` in each folder, stop `cf dev`.

Check the dev server's printed port; the curl above assumes Vite's default.

## Status

Done 2026-10-01. Repo `default/appmarket-first-repo`, initial commit `a9d0f7b`.

Remote: `https://aada0f21d612f647ef27d21e1c09b648.artifacts.cloudflare.net/git/default/appmarket-first-repo.git`

`cf artifacts ...` CLI commands return 403 with the `cf` OAuth login even on Workers Paid; the Worker binding works. Use the routes below.

## Push your own code

Since R3 (#10) the unauthenticated Phase 0 routes are gone. Every repo belongs to a listing, and tokens come from a signed-in route: write for the listing owner only, read for owner/admin (or anyone signed in once published). Lifetimes default to 1 hour (max 8 h write, 24 h read). Every mint is audited by token id; the token itself is returned once and never stored.

Locally (`dev` namespace), sign in without OAuth using `dev:login` (see [auth setup](auth-setup.md)):

```sh
pnpm --filter @appmarket/api dev        # in another terminal
COOKIE=$(pnpm -s --filter @appmarket/api dev:login you@example.test developer)

# Once: create a listing; its Artifacts repo is created with it
SLUG=$(curl -s http://localhost:5173/api/listings -H "Cookie: $COOKIE" -H 'Content-Type: application/json' \
  -d '{"name":"My App","summary":"What it does in a sentence","category":"developer-tools"}' | jq -r .slug)

# Each push: mint a fresh write token
BODY=$(curl -s http://localhost:5173/api/listings/$SLUG/tokens -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d '{"scope":"write"}')
export ARTIFACTS_REMOTE=$(printf '%s' "$BODY" | jq -r .remote)
export ARTIFACTS_TOKEN=$(printf '%s' "$BODY" | jq -r .token)
unset BODY

cd ~/path/to/your-project
git remote add artifacts "$ARTIFACTS_REMOTE"      # once; the URL holds no credentials
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push artifacts main --tags
unset ARTIFACTS_TOKEN
```

To publish: `POST /api/listings/$SLUG/transitions` with `{"to":"submitted","tag":"v1.0.0"}`; an admin approves with `{"to":"published"}`. Never put the token in the remote URL or `git config` (`pnpm check:secrets` catches any `art_v*_` token there). The Phase 0 test repo stays in the unused `default` namespace.
