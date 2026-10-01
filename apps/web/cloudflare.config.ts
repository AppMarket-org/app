import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "appmarket-web",
		compatibilityDate: "2026-10-01",
		entrypoint,
		env: {
			// PRD Phase 0: remote so `cf dev` creates real repos on Cloudflare, not a local simulation.
			// Phase 1 (R4) splits this into dev, staging and prod namespaces.
			ARTIFACTS: bindings.artifacts({ namespace: "default", dev: { remote: true } }),
			// Phase 1: DB (D1, R1/R11/R12), RELEASES (R2, R5/R13), RATE_LIMITER (R20).
		},
	},
});
