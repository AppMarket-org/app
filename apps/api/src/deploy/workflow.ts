import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import type { DeploymentStatus } from "@appmarket/shared";
import { NonRetryableError } from "cloudflare:workflows";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { accessToken } from "../cloudflare/oauth.ts";
import { buildCommand, deployCommand, type DeployPlan, SECRET_ENV_PREFIX, workerUrl } from "./commands.ts";
import { logSection } from "./logs.ts";
import { appendDeploymentLog, finishDeployment, loadDeployment, readDeploymentSecrets, setDeploymentStatus } from "./store.ts";
import { logEvent } from "../observability/log.ts";

export { CiSandbox } from "./sandbox.ts";

/** Workflow params: the CI source plus the deployment row id. Never holds tokens or secret values. */
export type DeployParams = CiParams<CloudflareArtifacts> & { deploymentId: string };

/**
 * PRD D6: build a repo version in appmarket.org's account and deploy it into the buyer's.
 * Workflow params and step outputs are persisted, so the buyer's token and secrets are read when the
 * deploy step runs and passed only to that step's command environment. The build step, which runs
 * the repo's own install and build scripts, never sees them.
 */
export class DeployWorkflow extends CIWorkflow<CloudflareArtifacts, Env & CiBindings> {
	protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
		const { deploymentId } = event.payload as DeployParams;
		const status = (name: DeploymentStatus) => step.do(`status: ${name}`, () => setDeploymentStatus(deploymentId, name));
		try {
			const deployment = await step.do("load deployment", () => loadDeployment(deploymentId));
			const plan = JSON.parse(deployment.plan) as DeployPlan;
			await status("building");
			const built = await ci.runner({ name: "build", command: buildCommand(plan), config: { timeout: 15 * 60_000, retries: { limit: 1, delay: 10_000 } } });
			await step.do("log: build", () => appendDeploymentLog(deploymentId, logSection("Install and build", built.logs)));
			await status("deploying");

			const token = await accessToken(deployment.userId);
			if (!token) throw new NonRetryableError("Your Cloudflare account is no longer connected. Reconnect it and deploy again.");
			const secrets = await readDeploymentSecrets(deploymentId, deployment.userId);
			const deployed = await built.runner({
				name: "deploy",
				command: deployCommand(plan),
				env: {
					CLOUDFLARE_API_TOKEN: token,
					CLOUDFLARE_ACCOUNT_ID: deployment.accountId,
					APPMARKET_DEPLOY_CONFIG: JSON.stringify(plan.config),
					...Object.fromEntries(Object.entries(secrets).map(([name, value]) => [SECRET_ENV_PREFIX + name, value])),
					WRANGLER_SEND_METRICS: "false",
				},
				config: { timeout: 10 * 60_000, retries: { limit: 1, delay: 10_000 } },
			});
			await step.do("log: deploy", () => appendDeploymentLog(deploymentId, logSection("Deploy to Cloudflare", deployed.logs)));
			const url = workerUrl(typeof deployed.logs.stdout === "string" ? deployed.logs.stdout : "", plan.workerName);
			await step.do("finish", async () => {
				await finishDeployment(deploymentId, "succeeded", { url });
				logEvent("deploy.succeeded", { deployment: deploymentId });
			});
		} catch (error) {
			await step.do("fail", async () => {
				await appendDeploymentLog(deploymentId, logSection("Failed", { stdout: error instanceof Error ? error.message : String(error) }));
				await finishDeployment(deploymentId, "failed", { error: failureMessage(error) });
				logEvent("deploy.failed", { deployment: deploymentId, error: failureMessage(error) }, "error");
			});
			throw error;
		}
	}
}

/** A short reason for the buyer. Runner failures carry the command's output tail; keep its last lines. */
function failureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n").filter(Boolean).slice(-12).join("\n").slice(0, 2000);
}
