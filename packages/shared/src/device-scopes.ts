/**
 * #107: what a device sign-in (CLI, CI token) may do. One list for the API (which grants and
 * enforces them) and the approval page (which must show all of them).
 */
export const DEVICE_CLIENT_SCOPES: Readonly<Record<string, readonly string[]>> = {
	// #29: sessions:write lets `appmarket session` start agent sessions in forks. CI tokens cannot.
	// #194: memory:read and memory:write let agents recall and keep repo notes.
	// git:write pushes over appmarket.org's Git remotes.
	// pulls:write opens, comments on, reviews and merges pull requests (#260).
	"appmarket-cli": ["checkpoints:write", "checkpoints:read", "repos:read", "sessions:write", "memory:read", "memory:write", "git:write", "pulls:write"],
	// #134: CI tokens created in Settings, for pipelines that cannot approve a device code.
	// #34: CI pipelines upload release builds (releases:write).
	"appmarket-ci": ["checkpoints:write", "checkpoints:read", "repos:read", "releases:write", "memory:read"],
};

/** How the approval page describes each scope ("This device will be able to …"). */
export const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
	"repos:read": "see your repos and clone them",
	"git:write": "push code to your repos",
	"pulls:write": "open, comment on, review and merge pull requests",
	"checkpoints:write": "upload checkpoints (prompts and agent activity) for your commits",
	"checkpoints:read": "read your checkpoints",
	"sessions:write": "start agent sessions, each in its own fork of a repo",
	"memory:read": "read your repos' memory notes",
	"memory:write": "add and change your repos' memory notes",
	"releases:write": "upload release builds",
};

/** The scopes a sign-in gets: the ones it asked for, or its client's default set. */
export function grantedScopes(clientId: string, requested: string | null | undefined): string[] {
	const asked = (requested ?? "").split(/\s+/).filter(Boolean);
	return asked.length ? asked : [...(DEVICE_CLIENT_SCOPES[clientId] ?? [])];
}
