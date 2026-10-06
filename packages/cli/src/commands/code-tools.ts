import { ApiError, call as apiCall } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { storedSessions } from "./session.ts";

/**
 * #240: MCP tools over the repo's code graph on appmarket.org (its default branch): where a symbol
 * is defined, who imports a file, and what a change can affect. Same tools in every harness.
 */
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

export const CODE_TOOLS = [
	{
		name: "code_find_symbol",
		description: "Find where a function, class, type or constant is defined in this repo (its default branch on appmarket.org). Exact name matches first, then names starting with it. Covers TypeScript/JavaScript and Python.",
		inputSchema: obj({ name: { type: "string", description: "The identifier, or its start." } }, ["name"]),
	},
	{
		name: "code_references",
		description: "For one file: the files that import it, and the files it imports. Use it before changing a module's exports.",
		inputSchema: obj({ path: { type: "string", description: "Repo-relative file path, e.g. src/db/store.ts." } }, ["path"]),
	},
	{
		name: "code_impact",
		description: "What a change to these files or directories can affect: every file that imports them, directly or through others (up to 3 levels). Use it to pick what to lease and test.",
		inputSchema: obj({ paths: { type: "array", items: { type: "string" }, description: "Files, or directories ending in /." } }, ["paths"]),
	},
] as const;

export const CODE_TOOL_NAMES: ReadonlySet<string> = new Set(CODE_TOOLS.map((t) => t.name));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export interface CodeDeps {
	call: typeof apiCall;
	token: (api: string) => Promise<string | null>;
}
const defaults: CodeDeps = { call: apiCall, token: async (api) => (await loadCredentials(api))?.token ?? null };

export async function callCodeTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), deps: CodeDeps = defaults): Promise<Result> {
	const root = repoRoot(cwd);
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) return text("This folder is not an appmarket.org repo (run `appmarket init`).", true);
	const session = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root });
	const api = (session && storedSessions().find((s) => s.id === session)?.api) || gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	const token = await deps.token(api);
	if (!token) return text("Not signed in to appmarket.org: run `appmarket login`.", true);
	const get = <T>(path: string) => deps.call<T>(api, `/api/repos/${repo}/code-graph${path}`, { token, timeoutMs: 60_000 });
	try {
		switch (name) {
			case "code_find_symbol": {
				if (typeof args.name !== "string" || !args.name.trim()) return text("name is required.", true);
				const r = await get<{ commit: string; symbols: { path: string; name: string; kind: string; line: number; exported: boolean }[] }>(`/symbols?q=${encodeURIComponent(args.name.trim())}`);
				if (!r.symbols.length) return text(`No definition of ${args.name} found (graph of ${r.commit.slice(0, 12)}).`);
				return text(r.symbols.map((s) => `${s.path}:${s.line}  ${s.exported ? "export " : ""}${s.kind} ${s.name}`).join("\n") + `\n(graph of ${r.commit.slice(0, 12)})`);
			}
			case "code_references": {
				if (typeof args.path !== "string" || !args.path.trim()) return text("path is required.", true);
				const r = await get<{ commit: string; importedBy: string[]; imports: string[] }>(`/references?path=${encodeURIComponent(args.path.trim())}`);
				return text(
					[`Imported by (${r.importedBy.length}):`, ...r.importedBy.map((p) => `  ${p}`), `Imports (${r.imports.length}):`, ...r.imports.map((p) => `  ${p}`), `(graph of ${r.commit.slice(0, 12)})`].join("\n"),
				);
			}
			case "code_impact": {
				const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && !!p.trim()) : [];
				if (!paths.length) return text("paths is required.", true);
				const r = await get<{ commit: string; affected: { path: string; depth: number; via: string }[] }>(`/impact?paths=${encodeURIComponent(paths.join(","))}`);
				if (!r.affected.length) return text(`Nothing in the repo imports ${paths.join(", ")} (graph of ${r.commit.slice(0, 12)}).`);
				return text(r.affected.map((a) => `${a.path}  (${a.depth === 1 ? "imports" : `${a.depth} levels, via`} ${a.via})`).join("\n") + `\n(graph of ${r.commit.slice(0, 12)})`);
			}
			default:
				return text(`Unknown tool: ${name}`, true);
		}
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.status === 401) return text("Not signed in to appmarket.org: run `appmarket login`.", true);
			if (error.status === 404) return text("No code graph for this repo (or no access to it).", true);
			const body = (error.body ?? {}) as { message?: string; error?: string };
			return text(body.message ?? body.error ?? `HTTP ${error.status}`, true);
		}
		return text(`appmarket.org could not be reached (${error instanceof Error ? error.message : String(error)}).`, true);
	}
}
