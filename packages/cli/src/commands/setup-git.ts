import { spawnSync } from "node:child_process";
import { call } from "../api.ts";
import { loadCredentials } from "../credentials.ts";

/** The origin Git sees for appmarket.org remotes: the API's own (it serves /<owner>/<repo>.git). */
export const gitOrigin = (api: string) => new URL(api).origin;

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" });

/**
 * `appmarket setup-git`: Git asks `appmarket git-credential` for appmarket.org remotes, which answers
 * with this machine's sign-in (or an agent session's token for session remotes). Other helpers are
 * cleared for this host only, so the token never lands in a keychain. `--remove` undoes it.
 */
export async function setupGit(api: string, remove: boolean): Promise<number> {
	const origin = gitOrigin(api);
	const section = `credential.${origin}`;
	git(["config", "--global", "--unset-all", `${section}.helper`]);
	git(["config", "--global", "--unset-all", `${section}.useHttpPath`]);
	if (remove) {
		console.log(`Git no longer asks appmarket for ${origin}.`);
		return 0;
	}
	for (const args of [
		["--add", `${section}.helper`, ""],
		["--add", `${section}.helper`, "!appmarket git-credential"],
		[`${section}.useHttpPath`, "true"],
	]) {
		const r = git(["config", "--global", ...args]);
		if (r.status !== 0) {
			console.error(`Could not update your Git config: ${r.stderr.trim()}`);
			return 1;
		}
	}
	console.log(`Git now signs in to ${origin} with your appmarket login:\n  git clone ${origin}/<owner>/<repo>.git`);
	const creds = await loadCredentials(api);
	if (!creds) {
		console.log("You are not signed in yet: run `appmarket login`.");
		return 0;
	}
	const session = await call<{ session: { scopes?: string | null } } | null>(api, "/api/auth/get-session", { token: creds.token }).catch(() => null);
	const scopes = session?.session.scopes;
	if (scopes != null && !scopes.split(" ").includes("git:write")) console.log("Your sign-in can clone but not push: run `appmarket login` again to add pushing.");
	return 0;
}

/** The sign-in to hand Git for a remote on this API's host, or null. */
export async function tokenForRemote(url: string, api: string): Promise<string | null> {
	let origin: string;
	try {
		origin = new URL(url).origin;
	} catch {
		return null;
	}
	const creds = (await loadCredentials(origin)) ?? (origin === gitOrigin(api) ? await loadCredentials(api) : null);
	return creds?.token ?? null;
}
