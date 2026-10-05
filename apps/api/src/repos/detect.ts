import type { Runtime } from "@appmarket/shared";
import { detectRuntime, RUNTIME_FILES } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { readFiles, readRootEntries } from "../artifacts/git.ts";

/** The runtime of the code at a commit, or null when there is nothing to go on yet. */
export async function runtimeAt(gitRepo: string, commit: string): Promise<Runtime | null> {
	const [root, files] = await Promise.all([readRootEntries(gitRepo, commit), readFiles(gitRepo, commit, RUNTIME_FILES)]);
	return detectRuntime(
		root.filter((e) => e.type !== "tree").map((e) => e.name),
		root.filter((e) => e.type === "tree").map((e) => e.name),
		files,
	);
}

/** Records a detected runtime. */
export async function saveRuntime(repoId: string, runtime: Runtime): Promise<void> {
	await env.DB.prepare("UPDATE repos SET runtime = ?, runtime_detected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(runtime, repoId).run();
}

/** Detects at the newest commit of the default branch (import, fork); quietly does nothing for empty repos. */
export async function detectAtHead(repoId: string, gitRepo: string): Promise<Runtime | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const [head] = await git.log({ limit: 1 }).catch(() => []);
	if (!head) return null;
	const runtime = await runtimeAt(gitRepo, head.hash);
	if (runtime) await saveRuntime(repoId, runtime);
	return runtime;
}
