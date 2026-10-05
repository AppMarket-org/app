/**
 * Git over HTTPS at appmarket.org/<owner>/<repo>.git: which service a request is for, and what it
 * needs. Pure, for tests.
 */
export type GitService = "git-upload-pack" | "git-receive-pack";

export interface GitRoute {
	owner: string;
	slug: string;
	/** info/refs (the ref advertisement) or the service endpoint itself. */
	kind: "info/refs" | "service";
	service: GitService;
}

/** Parses /<owner>/<repo>.git/info/refs?service=… and /<owner>/<repo>.git/git-(upload|receive)-pack. */
export function parseGitPath(pathname: string, search: URLSearchParams, method: string): GitRoute | null {
	const m = /^\/([^/]+)\/([^/]+?)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(pathname);
	if (!m) return null;
	const [, owner, slug, rest] = m as unknown as [string, string, string, string];
	if (rest === "info/refs") {
		const service = search.get("service");
		if (method !== "GET" || (service !== "git-upload-pack" && service !== "git-receive-pack")) return null;
		return { owner, slug, kind: "info/refs", service };
	}
	if (method !== "POST") return null;
	return { owner, slug, kind: "service", service: rest as GitService };
}

/** The credential Git sent: Basic (password is the token) or Bearer. */
export function credentialOf(authorization: string | null | undefined): string | null {
	if (!authorization) return null;
	const [scheme, value] = authorization.split(/\s+/, 2);
	if (!value) return null;
	if (scheme!.toLowerCase() === "bearer") return value.trim() || null;
	if (scheme!.toLowerCase() !== "basic") return null;
	try {
		const decoded = atob(value);
		const i = decoded.indexOf(":");
		const password = i === -1 ? "" : decoded.slice(i + 1);
		return password || null;
	} catch {
		return null;
	}
}

/** Artifacts repo tokens (from the dashboard, agent sessions) are passed through: Artifacts checks them. */
export const isArtifactsToken = (token: string) => /^art_v\d+_/.test(token);

/** Headers copied to Artifacts; everything else (cookies, the caller's auth) stays here. */
export const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "accept-encoding", "content-encoding", "git-protocol", "user-agent"];
export const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "expires", "pragma", "content-encoding"];
