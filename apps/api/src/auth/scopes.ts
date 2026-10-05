// #107 (Checkpoints PRD, "Device code auth"): what a device-login session may do. Browser sessions
// have no scopes and full access; device sessions are limited to these scopes and the routes below.

/** Scopes each device client may request; also its default when it asks for none. */
export const DEVICE_CLIENT_SCOPES: Readonly<Record<string, readonly string[]>> = {
	// #29: sessions:write lets `appmarket session` start agent sessions in forks. CI tokens cannot.
	"appmarket-cli": ["checkpoints:write", "checkpoints:read", "repos:read", "sessions:write"],
	// #134: CI tokens created in Settings, for pipelines that cannot approve a device code.
	// #34: CI pipelines upload release builds (releases:write).
	"appmarket-ci": ["checkpoints:write", "checkpoints:read", "repos:read", "releases:write"],
};

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
	{ scope: "checkpoints:write", methods: ["POST", "PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/checkpoints(/[^/]+(/transcript)?)?$`) },
	{ scope: "releases:write", methods: ["POST"], path: new RegExp(`^/api/repos/${REPO}/releases$`) },
	{ scope: "sessions:write", methods: ["GET", "POST"], path: new RegExp(`^/api/repos/${REPO}/sessions$`) },
	{ scope: "sessions:write", methods: ["POST"], path: /^\/api\/sessions\/[0-9a-f-]{36}\/(token|end)$/ },
	{ scope: "sessions:write", methods: ["DELETE"], path: /^\/api\/sessions\/[0-9a-f-]{36}$/ },
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
