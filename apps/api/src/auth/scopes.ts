// #107 (Checkpoints PRD, "Device code auth"): what a device-login session may do. Browser sessions
// have no scopes and full access; device sessions are limited to these scopes and the routes below.

/** Scopes each device client may request; also its default when it asks for none. */
export const DEVICE_CLIENT_SCOPES: Readonly<Record<string, readonly string[]>> = {
	"appmarket-cli": ["checkpoints:write", "checkpoints:read", "repos:read"],
	// #134: CI tokens created in Settings, for pipelines that cannot approve a device code.
	"appmarket-ci": ["checkpoints:write", "checkpoints:read", "repos:read"],
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
	{ scope: "checkpoints:read", methods: ["GET"], path: new RegExp(`^/api/repos/${REPO}/checkpoints(/[^/]+)?$`) },
	{ scope: "checkpoints:write", methods: ["POST", "PATCH", "DELETE"], path: new RegExp(`^/api/repos/${REPO}/checkpoints(/[^/]+(/transcript)?)?$`) },
];

/** Better Auth endpoints a device session may use: read its own session and sign itself out. */
const AUTH_PATHS = /^\/api\/auth\/(get-session|sign-out|device(\/(code|token))?)$/;

export function deviceMayCall(scopes: readonly string[], method: string, path: string): boolean {
	return RULES.some((r) => r.methods.includes(method) && r.path.test(path) && (r.scope === null || scopes.includes(r.scope)));
}

export function deviceMayCallAuth(path: string): boolean {
	return AUTH_PATHS.test(path);
}
