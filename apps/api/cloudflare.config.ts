import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { ENVIRONMENTS, resolveEnvironment } from "./environments.ts";

export default defineConfig(({ mode }) => {
	const environment = resolveEnvironment(mode);
	const { workerName, artifactsNamespace, database, publicOrigin } = ENVIRONMENTS[environment];

	return {
		worker: {
			name: workerName,
			compatibilityDate: "2026-10-01",
			// Better Auth uses AsyncLocalStorage.
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			env: {
				APP_ENV: bindings.text(environment),
				PUBLIC_ORIGIN: bindings.text(publicOrigin),
				// Remote in dev so `cf dev` creates real repos on Cloudflare, not a local simulation.
				ARTIFACTS: bindings.artifacts({ namespace: artifactsNamespace, dev: { remote: true } }),
				// Local simulation in dev; apply migrations with `pnpm --filter @appmarket/api db:migrate`.
				DB: bindings.d1(database),
				// R11 auth. Local values in apps/api/.dev.vars (see .dev.vars.example); deployed via `cf secrets`.
				BETTER_AUTH_SECRET: bindings.secret(),
				GOOGLE_CLIENT_ID: bindings.secret(),
				GOOGLE_CLIENT_SECRET: bindings.secret(),
				GITHUB_CLIENT_ID: bindings.secret(),
				GITHUB_CLIENT_SECRET: bindings.secret(),
				TURNSTILE_SECRET_KEY: bindings.secret(),
				// Phase 1: RELEASES (R2, R5/R13), RATE_LIMITER (R20).
			},
		},
	};
});
