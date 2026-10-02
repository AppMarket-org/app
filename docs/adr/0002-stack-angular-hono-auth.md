# ADR 0002: Angular hybrid rendering, Hono API on Workers, Google + GitHub login

**Status:** Accepted (2026-10-01)

## UI: Angular (latest, 22.x) with Angular Material, SSR + SPA in one app

- `apps/web` is one Angular app deployed as a Worker (`appmarket-web`). Per-route render modes in `app.routes.server.ts`:
  - **Prerender** (build time): home, legal pages.
  - **Server** (per request, for SEO): `/apps/:slug`, `/category/:slug`, `/search`, 404s.
  - **Client** (SPA, `noindex`): `/login`, `/dashboard`, `/admin`.
- SEO: `Seo` service sets title, description, robots, canonical, Open Graph, Twitter and JSON-LD into server HTML. `robots.txt` in `public/`; `/sitemap.xml` served by the API.
- Static assets use `html_handling: drop-trailing-slash` so served URLs match canonical URLs.
- Component library: Angular Material (M3 theme in `material-theme.scss`).
- Conventions: SCSS only; every component has separate `.html` and `.scss` files (no inline `template`/`styles`); `OnPush`. Enforced as `ng generate` defaults in `angular.json`.
- No `px` anywhere: sizes in `rem` (16 px = 1 rem), shapes from Material tokens (`--mat-sys-corner-*`), media queries in `rem`.
- Material components for every widget: buttons and links (`mat-button` variants), chips, lists (`mat-list`), tables (`mat-table`), cards, dialogs, form fields. Plain layout/text elements are fine; `<pre>`/`<code>` are allowed (no Material code block); README HTML is rendered content. `pnpm check:ui` enforces both rules in CI.
- Built by the Angular CLI and run with Wrangler (`wrangler.jsonc`), because Angular builds outside the Vite plugin that `cf` uses.

## API: TypeScript + Hono on Workers

- `apps/api` (`appmarket-api`, a `cf` project). Only a Worker can use the Artifacts binding; D1, R2, rate limiting and Workflows bind directly. Shared types with Angular via `packages/shared`.
- `appmarket-web` forwards `/api/*` and `/sitemap.xml` to `appmarket-api` over a service binding (no public hop). Locally, `ng serve` proxies the same paths to `cf dev` on port 5173 (`pnpm dev` runs both).

## Auth: Google and GitHub login in the MVP

- Cloudflare has no end-user auth product. Cloudflare Access is for staff (used for `/admin`); Cloudflare OAuth clients are "connect your Cloudflare account" (used for deploys, D5); Turnstile is bot protection on forms.
- Login runs in our API Worker: Google and GitHub OAuth, sessions in D1, likely via Better Auth. Both providers are Phase 1 (R11).
