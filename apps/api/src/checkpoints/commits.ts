import type { Checkpoint, CommitEntry } from "@appmarket/shared";

const PROMPTS_SHOWN = 3;
const PROMPT_CHARS = 400;

/** Commits with the prompts behind them, where the viewer may see the commit's checkpoint. */
export function commitEntries(commits: readonly ArtifactsCommitMetadata[], checkpoints: ReadonlyMap<string, Checkpoint>): CommitEntry[] {
	return commits.map((c) => {
		const cp = checkpoints.get(c.hash);
		const prompts = cp?.prompts ?? [];
		return {
			sha: c.hash,
			title: c.message.split("\n")[0]!.slice(0, 200),
			author: { name: c.author.name },
			date: new Date(c.authoredAt < 1e12 ? c.authoredAt * 1000 : c.authoredAt).toISOString(),
			checkpoint: cp
				? {
						harness: cp.harness,
						model: cp.model,
						visibility: cp.visibility,
						prompts: prompts.slice(0, PROMPTS_SHOWN).map((p) => (p.text.length > PROMPT_CHARS ? `${p.text.slice(0, PROMPT_CHARS)}…` : p.text)),
						promptCount: prompts.length,
					}
				: null,
		};
	});
}
