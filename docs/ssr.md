# Server-side rendering and API data (#44)

Public pages (`/apps/:slug`, `/category/:slug`, `/search`) are rendered by Angular on the web Worker with real API data, for SEO. Render modes are in `apps/web/src/app/app.routes.server.ts`.

## How a server render gets data

1. A route resolver (for example `pages/repo/repo-resolver.ts`) calls `HttpClient.get('/api/...')`. SSR waits for it.
2. `serverApiInterceptor` (`app/api/server-api.ts`) runs only on the server: it makes the URL absolute, forwards the visitor's `Cookie` (so owners can render their own drafts), and
   - **on Workers:** sends it over the `API` service binding via `REQUEST_CONTEXT.apiFetch`, set in `src/server.ts` (no public hop);
   - **under `ng serve`:** lets it go to the dev server, which proxies `/api` to the API on :5173.
3. Angular's HTTP transfer cache embeds GET responses in the page (`<script id="ng-state">`), so the browser does not refetch while hydrating.
4. A 404 from the API sets the page's HTTP status to 404 via `RESPONSE_INIT`, and the page is marked `noindex`.

## Local development

`pnpm dev` runs the API (`cf dev`, :5173) and Angular (`ng serve`, :4200). That covers SSR with real data.

The service-binding path can only be exercised with `wrangler dev` on the built web Worker, which cannot see a `cf dev` API (they do not share a dev registry today). To check it, run the web Worker together with a stub API Worker named `appmarket-api`:

```sh
pnpm --filter @appmarket/web build
cd apps/web && npx wrangler dev -c wrangler.jsonc -c path/to/stub/wrangler.jsonc
```

## Caching

Pages rendered with a visitor's cookie must never be shared-cached. Caching of public SSR pages is tracked in #45.
