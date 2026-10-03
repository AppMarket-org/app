import { execFileSync } from "node:child_process";

/** Runs git and returns stdout (trimmed). Throws on a non-zero exit. */
export function git(args: string[], opts: { cwd?: string; input?: string } = {}): string {
	return execFileSync("git", args, { cwd: opts.cwd, input: opts.input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

export function gitOr(args: string[], fallback: string, opts: { cwd?: string } = {}): string {
	try {
		return git(args, opts);
	} catch {
		return fallback;
	}
}

export function repoRoot(cwd?: string): string | null {
	const root = gitOr(["rev-parse", "--show-toplevel"], "", { cwd });
	return root || null;
}
