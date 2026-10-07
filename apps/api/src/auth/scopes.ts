// #107 (Checkpoints PRD, "Device code auth"): what a device-login session may do. Browser sessions
// have no scopes and full access; device sessions are limited to these scopes and the routes below.

import { DEVICE_CLIENT_SCOPES } from "@appmarket/shared";

export { DEVICE_CLIENT_SCOPES };

/** The granted scopes: the request (or the client's default), refused if it asks for more. */
export function grantScopes(clientId: string, requested: string | undefined): string[] | null {
	const allowed = DEVICE_CLIENT_SCOPES[clientId];
	if (!allowed) return null;
	const asked = (requested ?? "").split(/\s+/).filter(Boolean);
	if (asked.length === 0) return [...allowed];
	return asked.every((s) => allowed.includes(s)) ? [...new Set(asked)] : null;
}

type Rule = { scope: string | null; methods: readonly string[]; path: RegExp };

const REPO = "[^/]+/[^/]+";
/** Routes a device session may call. `scope: null` = any device session (its own identity). */
const RULES: readonly Rule[] = [
	{ scope: null, methods: ["GET"], path: /^\/api\/me(\/owner)?$/ },
	{ scope: null, methods: ["PUT"], path: /^\/api\/me\/device$/ },
	{ scope: "repos:read", methods: ["GET"], path: /^\/api\/repos(\/mine)?$/ },
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}(/(versions|readme|screenshots|releases|repo-map|git|events))?$`) },
	{ scope: "repos:read", methods: ["GET"], path: /^\/api\/owners\/[^/]+$/ },
	{ scope: "checkpoints:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/checkpoints(/[^/]+(/transcript)?)?$`) },
	// #71: the session handoff, assembled from checkpoints.
	{ scope: "checkpoints:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/handoff$`) },
	{ scope: "checkpoints:write", methods: ["POST", "PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/checkpoints(/[^/]+(/transcript)?)?$`) },
	{ scope: "releases:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/releases$`) },
	{ scope: "sessions:write", methods: ["GET", "POST"], path: new RegExp(`^/api/repos/${REPO}/sessions$`) },
	{ scope: "sessions:write", methods: ["POST"], path: /^\/api\/sessions\/[0-9a-f-]{36}\/(token|end)$/ },
	{ scope: "sessions:write", methods: ["DELETE"], path: /^\/api\/sessions\/[0-9a-f-]{36}$/ },
	// #194: repo memory. CI tokens read only.
	{ scope: "memory:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/memory(/[0-9a-f-]{36}(/history)?)?$`) },
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/public-memory$`) },
	{ scope: "memory:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/memory-suggestions$`) },
	{ scope: "memory:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/memory-suggestions/[0-9a-f-]{36}/(accept|dismiss)$`) },
	{ scope: "memory:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/memory$`) },
	{ scope: "memory:write", methods: ["PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/memory/[0-9a-f-]{36}$`) },
	// #260: pull requests from the CLI and agents. Reading with repos:read; changes with pulls:write.
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/(pulls(/sources|/[0-9]+(/(files|diff|comments))?)?|compare)$`) },
	{ scope: "pulls:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/pulls(/[0-9]+/(merge|comments|reviews))?$`) },
	{ scope: "pulls:write", methods: ["PATCH"], path: new RegExp(`^/api/repos/${REPO}/pulls/[0-9]+$`) },
	{ scope: "pulls:write", methods: ["PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/pulls/[0-9]+/comments/[0-9a-f-]{36}$`) },
	// #294: issues. Reading with repos:read; opening, triaging and commenting with issues:write.
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/issues(/[0-9]+(/comments)?)?$`) },
	{ scope: "issues:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/issues(/[0-9]+/comments)?$`) },
	{ scope: "issues:write", methods: ["PATCH"], path: new RegExp(`^/api/repos/${REPO}/issues/[0-9]+$`) },
	{ scope: "issues:write", methods: ["PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/issues/[0-9]+/comments/[0-9a-f-]{36}$`) },
	// #240: the code graph, for agents (definitions, importers, impact).
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/code-graph(/(symbols|references|impact|map|file))?$`) },
	// #239: the board over A2A (Agent Card readable like the repo; JSON-RPC like the plane routes).
	{ scope: "repos:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/(a2a|\\.well-known/agent-card\\.json)$`) },
	{ scope: "sessions:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/a2a$`) },
	// #236: agents in a session use the collaboration plane (tasks, Agent Card, claims, leases).
	{ scope: "sessions:write", methods: ["GET", "POST", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/plane(/(tasks(/[0-9a-f-]{36}/(claim|finish))?|agents|leases))?$`) },
];

/** Better Auth endpoints a device session may use: read its own session and sign itself out. */
const AUTH_PATHS = /^\/api\/auth\/(get-session|sign-out|device(\/(code|token))?)$/;

export function deviceMayCall(scopes: readonly string[], method: string, path: string): boolean {
	return RULES.some((r) => r.methods.includes(method) && r.path.test(path) && (r.scope === null || scopes.includes(r.scope)));
}

export function deviceMayCallAuth(path: string): boolean {
	return AUTH_PATHS.test(path);
}
