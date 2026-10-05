import { bindings, defineConfig, defineContainer, exports, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { CLOUDFLARE_ACCOUNT_ID, ENVIRONMENTS, RATE_LIMITS, resolveEnvironment } from "./environments.ts";

export default defineConfig(({ mode }) => {
	const environment = resolveEnvironment(mode);
	const { workerName, artifactsNamespace, database, publicOrigin, rateLimitBase, mediaBucket, releasesBucket, buildsBucket, access, emailFrom, emailRemote } = ENVIRONMENTS[environment];
	const rateLimit = ({ offset, limit, period }: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS]) =>
		bindings.rateLimit({ namespace: String(rateLimitBase + offset), simple: { limit, period } });

	// D6: one-click deploys build repos in a Sandbox container driven by a @cloudflare/ci Workflow.
	const buildContainer = defineContainer({
		name: `${workerName}-build`,
		image: { dockerfile: "./sandbox/Dockerfile" },
		instanceType: "standard-1",
		maxInstances: 5,
	});

	return {
		containers: [buildContainer],
		worker: {
			name: workerName,
			compatibilityDate: "2026-10-01",
			// Better Auth uses AsyncLocalStorage.
			compatibilityFlags: ["nodejs_compat"],
			// Reached only through the web Worker's service binding (and its Access-protected routes),
			// never on a public workers.dev or preview URL.
			workersDev: false,
			// #143: contributions from new commits (Artifacts sends no push events).
			triggers: [triggers.scheduled({ schedule: "* * * * *" })],
			previewUrls: false,
			// R23: logs, traces and Issues (error tracking) in Workers Observability. Query strings are
			// stripped from logged URLs: OAuth callbacks and download links carry codes and signatures.
			observability: {
				enabled: true,
				redactQueryString: true,
				issues: { enabled: true },
				logs: { enabled: true, invocationLogs: true },
				traces: { enabled: true, headSamplingRate: 0.1 },
			},
			entrypoint,
			exports: {
				CiSandbox: exports.durableObject({ storage: "sqlite", container: buildContainer }),
				// #182: exact rate limits for sensitive actions.
				RateLimiter: exports.durableObject({ storage: "sqlite" }),
				// #236: the collaboration plane's coordinator, one per repo.
				RepoPlane: exports.durableObject({ storage: "sqlite" }),
				DeployWorkflow: exports.workflow({ name: `${workerName}-deploy`, concurrency: { limit: 5 } }),
				ChecksWorkflow: exports.workflow({ name: `${workerName}-checks`, concurrency: { limit: 5 } }),
				// #238: merges agent work from the collaboration plane.
				MergeWorkflow: exports.workflow({ name: `${workerName}-merge`, concurrency: { limit: 5 } }),
			},
			env: {
				APP_ENV: bindings.text(environment),
				PUBLIC_ORIGIN: bindings.text(publicOrigin),
				// #230: notification email through Cloudflare Email Service; sending is off while EMAIL_FROM is empty.
				EMAIL: bindings.sendEmail({ ...(emailFrom ? { allowedSenderAddresses: [emailFrom] } : {}), dev: { remote: emailRemote } }),
				EMAIL_FROM: bindings.text(emailFrom),
				// R22: Access JWT check on /api/admin (src/auth/access.ts).
				ACCESS_TEAM_DOMAIN: bindings.text(access.teamDomain),
				ACCESS_AUD: bindings.text(access.aud),
				// Remote in dev so `cf dev` creates real repos on Cloudflare, not a local simulation.
				ARTIFACTS: bindings.artifacts({ namespace: artifactsNamespace, dev: { remote: true } }),
				ARTIFACTS_NAMESPACE: bindings.text(artifactsNamespace),
				// Local simulation in dev; apply migrations with `pnpm --filter @appmarket/api db:migrate`.
				DB: bindings.d1(database),
				// R11 auth. Local values in apps/api/.dev.vars (see .dev.vars.example); deployed via `cf secrets`.
				BETTER_AUTH_SECRET: bindings.secret(),
				GOOGLE_CLIENT_ID: bindings.secret(),
				GOOGLE_CLIENT_SECRET: bindings.secret(),
				GITHUB_CLIENT_ID: bindings.secret(),
				GITHUB_CLIENT_SECRET: bindings.secret(),
				TURNSTILE_SECRET_KEY: bindings.secret(),
				// R20 rate limits. RATE_LIMIT_CONFIG gives Worker code the same settings (it may not import this file).
				RATE_LIMIT_CONFIG: bindings.json(RATE_LIMITS),
				RL_DOWNLOAD_LINK: rateLimit(RATE_LIMITS.DOWNLOAD_LINK),
				// R24 screenshots. 
				MEDIA: bindings.r2({ name: mediaBucket }),
				// R13/R14 release binaries, served only through signed download links.
				RELEASES: bindings.r2({ name: releasesBucket }),
				DOWNLOAD_SIGNING_KEY: bindings.secret(),
				// D5: Cloudflare OAuth client (register under Manage Account > OAuth clients) and the key
				// that encrypts buyers' tokens at rest.
				CF_OAUTH_CLIENT_ID: bindings.secret(),
				CF_OAUTH_CLIENT_SECRET: bindings.secret(),
				CF_TOKEN_ENCRYPTION_KEY: bindings.secret(),
				// #129: base64 32-byte master key; per-account transcript keys are derived from it.
				TRANSCRIPT_KEY: bindings.secret(),
				// #42: Stripe (test or live) secret key; payments stay off while it is a placeholder.
				STRIPE_SECRET_KEY: bindings.secret(),
				// Checkpoint uploads per device (approximate is fine at 60/min); deploys use the exact RateLimiter.
				RL_CHECKPOINT: rateLimit(RATE_LIMITS.CHECKPOINT),
				DEPLOY_WORKFLOW: bindings.workflow({ name: `${workerName}-deploy`, worker: workerName, exportName: "DeployWorkflow" }),
				CHECKS_WORKFLOW: bindings.workflow({ name: `${workerName}-checks`, worker: workerName, exportName: "ChecksWorkflow" }),
				MERGE_WORKFLOW: bindings.workflow({ name: `${workerName}-merge`, worker: workerName, exportName: "MergeWorkflow" }),
				SANDBOX: bindings.durableObject({ worker: workerName, exportName: "CiSandbox" }),
				RATE_LIMITER: bindings.durableObject({ worker: workerName, exportName: "RateLimiter" }),
				PLANE: bindings.durableObject({ worker: workerName, exportName: "RepoPlane" }),
				CLOUDFLARE_ACCOUNT_ID: bindings.text(CLOUDFLARE_ACCOUNT_ID),
				BACKUP_BUCKET: bindings.r2({ name: buildsBucket }),
				BACKUP_BUCKET_NAME: bindings.text(buildsBucket),
				// Sandbox backups to R2 from deployed containers (an R2 API token scoped to the builds bucket).
				R2_ACCESS_KEY_ID: bindings.secret(),
				R2_SECRET_ACCESS_KEY: bindings.secret(),
			},
		},
	};
});
