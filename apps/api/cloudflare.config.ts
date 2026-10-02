import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { ENVIRONMENTS, resolveEnvironment } from "./environments.ts";

export default defineConfig(({ mode }) => {
	const environment = resolveEnvironment(mode);
	const { workerName, artifactsNamespace } = ENVIRONMENTS[environment];

	return {
		worker: {
			name: workerName,
			compatibilityDate: "2026-10-01",
			entrypoint,
			env: {
				APP_ENV: bindings.text(environment),
				// Remote in dev so `cf dev` creates real repos on Cloudflare, not a local simulation.
				ARTIFACTS: bindings.artifacts({ namespace: artifactsNamespace, dev: { remote: true } }),
				// Phase 1: DB (D1, R1/R11/R12), RELEASES (R2, R5/R13), RATE_LIMITER (R20).
			},
		},
	};
});
