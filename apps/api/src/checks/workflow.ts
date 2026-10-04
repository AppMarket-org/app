import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import { env } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { logEvent } from "../observability/log.ts";
import { CHECKS, checkCommand, type CheckResult, installCommand, parseCheck } from "./commands.ts";
import { CheckStore } from "./store.ts";

export type ChecksParams = CiParams<CloudflareArtifacts> & { runId: string };

/**
 * #27 (R7): install once, then lint, typecheck, tests and the security scan in parallel, in a
 * Sandbox container in appmarket.org's account (no tokens or secrets in the environment).
 */
export class ChecksWorkflow extends CIWorkflow<CloudflareArtifacts, Env & CiBindings> {
	protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
		const { runId } = event.payload as ChecksParams;
		const store = () => new CheckStore(env.DB);
		try {
			await step.do("status: running", () => store().setStatus(runId, "running"));
			const installed = await ci.runner({ name: "install", command: installCommand, config: { timeout: 10 * 60_000, retries: { limit: 1, delay: 10_000 } } });
			const results: CheckResult[] = await Promise.all(
				CHECKS.map(async (name) => {
					const done = await installed.runner({ name, command: checkCommand(name), config: { timeout: 10 * 60_000 } });
					return parseCheck(name, typeof done.logs.stdout === "string" ? done.logs.stdout : "");
				}),
			);
			const status = results.some((r) => r.status === "failed") ? "failed" : "passed";
			await step.do("finish", async () => {
				await store().setStatus(runId, status, results);
				logEvent("checks.finished", { run: runId, status });
			});
		} catch (error) {
			// The install itself failed (or the container did): the run errors, which also blocks publishing.
			await step.do("error", async () => {
				await store().setStatus(runId, "error", [{ name: "install", status: "failed", output: `Install failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 4000) }]);
				logEvent("checks.error", { run: runId }, "error");
			});
			throw error;
		}
	}
}
