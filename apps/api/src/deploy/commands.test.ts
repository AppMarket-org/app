import { describe, expect, it } from "vitest";
import { buildCommand, deployCommand, workerUrl } from "./commands.ts";

const plan = {
	workerName: "my-todo",
	config: { name: "my-todo", main: "out/index.js" },
	assetsDir: "public",
	d1Migrations: [{ binding: "DB", dir: "db/migrations" }],
};

describe("deploy commands", () => {
	it("bundles a Worker with an entry, and runs a static site's build script", () => {
		expect(buildCommand(plan)).toContain("/usr/local/bin/wrangler deploy --dry-run --outdir .appmarket/out");
		const site = buildCommand({ ...plan, config: { name: "site" } });
		expect(site).not.toContain("--dry-run");
		// A static site built by its own script (Angular, React, Vite) before its assets are copied.
		expect(site).toContain("pnpm run --if-present build");
		expect(site).toContain("npm run build --if-present");
		expect(buildCommand(plan)).not.toContain("run build");
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

	it("vendors Python packages and deploys .py sources without bundling (#87)", () => {
		const py = { workerName: "py", config: { name: "py", main: "src/entry.py" }, assetsDir: null, d1Migrations: [], python: { sourceDir: "src" } };
		expect(buildCommand(py)).toContain("if [ -f pyproject.toml ]; then /usr/local/bin/pywrangler sync; fi");
		expect(buildCommand(py)).not.toContain("--dry-run");
		const deploy = deployCommand(py);
		expect(deploy).toContain("mkdir -p /tmp/appmarket-deploy/'src' && cp -R 'src'/. /tmp/appmarket-deploy/'src'/");
		expect(deploy).toContain("if [ -d python_modules ]; then cp -R python_modules /tmp/appmarket-deploy/python_modules; fi");
		expect(deploy).not.toContain(".appmarket/out");
		expect(deployCommand({ ...py, python: { sourceDir: "." } })).toContain("find . -maxdepth 1 -name '*.py' -exec cp {} /tmp/appmarket-deploy/ \\;");
	});

	it("finds the workers.dev URL for this Worker only", () => {
		const out = "Uploaded my-todo\nDeployed my-todo triggers\n  https://my-todo.someone.workers.dev\n  https://other.someone.workers.dev";
		expect(workerUrl(out, "my-todo")).toBe("https://my-todo.someone.workers.dev");
		expect(workerUrl("no url", "my-todo")).toBeNull();
	});
});
