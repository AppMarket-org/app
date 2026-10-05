import { describe, expect, it } from "vitest";
import { checkTemplate } from "./index";

const AGENTS = "# Agent guide\n\nThis Worker serves a todo API. Code in src/, tests with npm test, deploy with wrangler.";
const files = (entries: Record<string, string>) => new Map(Object.entries({ "AGENTS.md": AGENTS, ...entries }));
const good = {
	"wrangler.jsonc": `{
		// comment allowed
		"name": "todo",
		"main": "src/index.ts",
		"compatibility_date": "2026-10-01",
		"vars": { "APP_NAME": "Todo" },
		"d1_databases": [{ "binding": "DB", "database_name": "todo-db" }],
		"kv_namespaces": [{ "binding": "CACHE" }],
		"ai": { "binding": "AI" },
	}`,
	"package.json": JSON.stringify({ scripts: { build: "vite build" } }),
	".dev.vars.example": "# secrets\nOPENAI_API_KEY=\nSESSION_SECRET=xyz\n",
};

describe("checkTemplate", () => {
	it("accepts a complete Worker template and builds its manifest", () => {
		const result = checkTemplate({ runtime: "workers-js", rootEntries: ["src", "wrangler.jsonc", "package.json"], files: files(good) });
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.manifest).toEqual({
			resources: [
				{ type: "kv", binding: "CACHE", name: null },
				{ type: "d1", binding: "DB", name: "todo-db" },
				{ type: "workers-ai", binding: "AI", name: null },
			],
			envVars: ["APP_NAME"],
			secrets: ["OPENAI_API_KEY", "SESSION_SECRET"],
		});
	});

	it("requires AGENTS.md with real content (G4)", () => {
		const result = checkTemplate({ runtime: "workers-js", rootEntries: [], files: new Map(Object.entries({ ...good, "AGENTS.md": "# TODO" })) });
		expect(result.errors.map((e) => e.rule)).toContain("agents-md");
	});

	it("blocks committed secret files but allows examples", () => {
		const result = checkTemplate({ runtime: "workers-js", rootEntries: [".dev.vars", ".env.local", ".env.example", ".dev.vars.example"], files: files(good) });
		expect(result.errors.filter((e) => e.rule === "no-committed-secrets").map((e) => e.file)).toEqual([".dev.vars", ".env.local"]);
	});

	it("blocks secret-looking vars and incomplete bindings", () => {
		const result = checkTemplate({
			runtime: "workers-js",
			rootEntries: [],
			files: files({
				...good,
				"wrangler.jsonc": JSON.stringify({ name: "x", main: "i.ts", compatibility_date: "2026-10-01", vars: { STRIPE_SECRET: "sk_live" }, d1_databases: [{ binding: "DB" }], durable_objects: { bindings: [{ name: "ROOM" }] } }),
			}),
		});
		expect(result.errors.map((e) => e.rule).sort()).toEqual(["binding-complete", "binding-complete", "vars-not-secret"]);
	});

	it("warns about hard-coded IDs, missing secret docs and missing build script", () => {
		const result = checkTemplate({
			runtime: "workers-js",
			rootEntries: [],
			files: files({ "wrangler.toml": 'name = "x"\nmain = "i.ts"\ncompatibility_date = "2026-10-01"\n[[kv_namespaces]]\nbinding = "KV"\nid = "abc123"\n', "package.json": "{}" }),
		});
		expect(result.errors).toEqual([]);
		expect(result.warnings.map((w) => w.rule).sort()).toEqual(["build-script", "hardcoded-ids", "secrets-documented"]);
	});

	it("reports missing or broken Wrangler config, except for static sites", () => {
		expect(checkTemplate({ runtime: "workers-js", rootEntries: [], files: files({}) }).errors.map((e) => e.rule)).toEqual(["wrangler-config"]);
		expect(checkTemplate({ runtime: "static", rootEntries: ["index.html"], files: files({}) }).errors).toEqual([]);
		const broken = checkTemplate({ runtime: "workers-js", rootEntries: [], files: files({ "wrangler.toml": "name = " }) });
		expect(broken.errors[0]?.rule).toBe("wrangler-config");
	});

	it("lists static assets, queues, durable objects and containers in the manifest", () => {
		const result = checkTemplate({
			runtime: "container",
			rootEntries: ["Dockerfile"],
			files: files({
				"wrangler.jsonc": JSON.stringify({
					name: "x",
					main: "i.ts",
					compatibility_date: "2026-10-01",
					assets: { directory: "./public", binding: "ASSETS" },
					queues: { producers: [{ binding: "JOBS", queue: "jobs" }] },
					durable_objects: { bindings: [{ name: "ROOM", class_name: "Room" }] },
					containers: [{ class_name: "App", image: "./Dockerfile" }],
				}),
				".dev.vars.example": "",
			}),
		});
		expect(result.manifest?.resources.map((r) => r.type)).toEqual(["queue", "durable-object", "container", "assets"]);
	});
});

describe("container apps (#54)", () => {
	const config = (image: string, withBinding = true) =>
		files({
			"wrangler.jsonc": JSON.stringify({
				name: "api",
				main: "src/index.ts",
				compatibility_date: "2026-10-01",
				containers: [{ class_name: "Api", image }],
				...(withBinding ? { durable_objects: { bindings: [{ name: "API", class_name: "Api" }] } } : {}),
			}),
			".dev.vars.example": "",
		});
	const pinned = `docker.io/acme/api:1.0@sha256:${"b".repeat(64)}`;

	it("requires a published image pinned by digest", () => {
		expect(checkTemplate({ runtime: "container", rootEntries: [], files: config(pinned) }).errors).toEqual([]);
		const built = checkTemplate({ runtime: "container", rootEntries: [], files: config("./Dockerfile") });
		expect(built.errors.map((e) => e.rule)).toEqual(["container-image"]);
		expect(checkTemplate({ runtime: "container", rootEntries: [], files: files({ "wrangler.jsonc": JSON.stringify({ name: "x", main: "a.ts", compatibility_date: "2026-01-01" }) }) }).errors.map((e) => e.rule)).toContain("container-image");
	});

	it("warns when no Durable Object binding uses the container class", () => {
		expect(checkTemplate({ runtime: "container", rootEntries: [], files: config(pinned, false) }).warnings.map((w) => w.rule)).toContain("container-binding");
	});

	it("does not ask a static site (assets, no Worker entry) to document secrets", () => {
		const site = new Map([
			["wrangler.jsonc", JSON.stringify({ name: "bombfind", compatibility_date: "2026-10-01", assets: { directory: "./public" } })],
			["package.json", JSON.stringify({ name: "bombfind", scripts: { test: "node --test" } })],
			["AGENTS.md", "# BombFind\n\nA Minesweeper-style puzzle served as static files.\n\n## Run and test\n\n- `npm test` runs the rule tests.\n- `npx wrangler dev` plays it locally.\n"],
		]);
		const result = checkTemplate({ runtime: "workers-js", rootEntries: ["wrangler.jsonc", "package.json", "AGENTS.md", "public"], files: site });
		expect(result.warnings.map((w) => w.rule)).not.toContain("secrets-documented");
		expect(result.errors).toEqual([]);
	});
});
