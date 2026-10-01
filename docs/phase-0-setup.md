# Phase 0: first Artifacts repository

Local only. No deploy, no billing changes. Re-read https://developers.cloudflare.com/artifacts/llms.txt and https://developers.cloudflare.com/cf/llms.txt first.

1. Node 22.18+; `pnpm install` (installs `cf` locally).
2. `pnpm --filter @appmarket/web exec cf auth login`, then `cf auth whoami`. Pin `CLOUDFLARE_ACCOUNT_ID` if you have several accounts.
3. Confirm the account is on Workers Paid (Artifacts is Paid-only). If not, stop.
4. `pnpm dev`. The `ARTIFACTS` binding uses `dev: { remote: true }`, so repos are created on Cloudflare.
5. Create the repo and keep the token in shell variables only:

```sh
RESPONSE=$(curl -s http://localhost:5173/repos -H 'Content-Type: application/json' -d '{"name":"appmarket-first-repo"}')
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
