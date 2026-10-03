import { describe, expect, it } from "vitest";
import { buildCommand, deployCommand, workerUrl } from "./commands.ts";

const plan = {
	workerName: "my-todo",
	config: { name: "my-todo", main: "out/index.js" },
	assetsDir: "public",
	d1Migrations: [{ binding: "DB", dir: "db/migrations" }],
};

describe("deploy commands", () => {
	it("bundles only when the Worker has an entry", () => {
		expect(buildCommand(plan)).toContain("/usr/local/bin/wrangler deploy --dry-run --outdir .appmarket/out");
		expect(buildCommand({ ...plan, config: { name: "site" } })).not.toContain("--dry-run");
	});

	it("deploys from a clean directory with the image's Wrangler and removes the secrets file", () => {
		const command = deployCommand(plan);
		expect(command).toContain("trap 'rm -f /tmp/appmarket-secrets.json' EXIT");
		expect(command).toContain("cp -R 'public' /tmp/appmarket-deploy/assets");
		expect(command).toContain("cp -R 'db/migrations' /tmp/appmarket-deploy/migrations/DB");
		expect(command).toContain("cd /tmp/appmarket-deploy");
		expect(command).toContain("/usr/local/bin/wrangler deploy --config wrangler.json --secrets-file /tmp/appmarket-secrets.json");
		expect(command).toContain("/usr/local/bin/wrangler d1 migrations apply DB --remote --config wrangler.json");
		// Nothing from the repo runs here: no package scripts, no npx, no workspace-relative Wrangler.
		expect(command).not.toMatch(/npm |npx |pnpm |node_modules/);
	});

	it("finds the workers.dev URL for this Worker only", () => {
		const out = "Uploaded my-todo\nDeployed my-todo triggers\n  https://my-todo.someone.workers.dev\n  https://other.someone.workers.dev";
		expect(workerUrl(out, "my-todo")).toBe("https://my-todo.someone.workers.dev");
		expect(workerUrl("no url", "my-todo")).toBeNull();
	});
});
