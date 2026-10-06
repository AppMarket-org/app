/**
 * #238: shell scripts for the merge Workflow. Both run in a fresh container that never runs the
 * repo's own code (no install, build or tests), so the write tokens in their environment cannot be
 * read by it. Tokens arrive as env vars and go to Git as an Authorization header, never into a
 * remote URL, Git config or the output.
 *
 * rebase: the agent's branch (in the session fork) rebased onto the repo's base branch, pushed back
 *   to the fork as appmarket/merge/<id>; checkpoint notes follow the rebased commits.
 * push:   fast-forwards the base branch to exactly that commit (FORK_REF: the rebased branch, or the
 *   branch itself when no rebase was needed; refused if the base moved), and merges the notes.
 * Each prints MARKER lines; parseMarkers reads them.
 */
export const MARKER = "APPMARKET_MERGE_";

const fetchWith = (header: string, remote: string, refspec: string) => `git -c http.extraHeader="Authorization: Bearer $${header}" fetch -q "$${remote}" "${refspec}"`;
const pushWith = (header: string, remote: string, refspec: string) => `git -c http.extraHeader="Authorization: Bearer $${header}" push -q "$${remote}" "${refspec}"`;

const prelude = [
	"set -eu",
	'dir=$(mktemp -d) && mkdir "$dir/repo" && cd "$dir/repo" && git init -q .',
	"git config user.name appmarket && git config user.email merge@appmarket.org",
	// Hooks never come with a fetch; this keeps any image-level hook path out too.
	"git config core.hooksPath /dev/null",
];

/** Env: MAIN_REMOTE, MAIN_TOKEN (read), FORK_REMOTE, FORK_TOKEN (write), BASE, BRANCH, MERGE_ID. */
export const rebaseScript = [
	...prelude,
	fetchWith("MAIN_TOKEN", "MAIN_REMOTE", "+refs/heads/$BASE:refs/remotes/main/base"),
	`${fetchWith("MAIN_TOKEN", "MAIN_REMOTE", "+refs/notes/appmarket:refs/notes/main")} 2>/dev/null || true`,
	`if ! ${fetchWith("FORK_TOKEN", "FORK_REMOTE", "+refs/heads/$BRANCH:refs/heads/work")} 2>/dev/null; then echo "${MARKER}STATUS=no_branch"; exit 0; fi`,
	`${fetchWith("FORK_TOKEN", "FORK_REMOTE", "+refs/notes/appmarket:refs/notes/appmarket")} 2>/dev/null || true`,
	"base=$(git rev-parse refs/remotes/main/base)",
	`echo "${MARKER}BASE=$base"`,
	'if [ -z "$(git rev-list "$base..work")" ]; then echo "' + MARKER + 'STATUS=nothing"; exit 0; fi',
	'old=$(git rev-list --reverse --no-merges "$base..work")',
	"git checkout -q work",
	// notes.rewriteRef copies each commit's checkpoint note to its rebased commit.
	'if ! git -c notes.rewriteRef=refs/notes/appmarket -c notes.rewrite.rebase=true rebase -q --empty=keep "$base" >/dev/null 2>&1; then',
	`  git diff --name-only --diff-filter=U | head -50 | sed 's/^/${MARKER}CONFLICT=/'`,
	`  git rebase --abort || true; echo "${MARKER}STATUS=conflict"; exit 0`,
	"fi",
	'head=$(git rev-parse HEAD); new=$(git rev-list --reverse --no-merges "$base..HEAD")',
	`echo "${MARKER}HEAD=$head"`,
	// Old → new pairs, when every commit survived one to one (the server copies checkpoints with them).
	`printf '%s\\n' "$old" > ../old.txt; printf '%s\\n' "$new" > ../new.txt`,
	`if [ "$(wc -l < ../old.txt)" = "$(wc -l < ../new.txt)" ]; then paste -d' ' ../old.txt ../new.txt | sed 's/^/${MARKER}MAP=/'; fi`,
	pushWith("FORK_TOKEN", "FORK_REMOTE", "+$head:refs/heads/appmarket/merge/$MERGE_ID"),
	`if git rev-parse -q --verify refs/notes/appmarket >/dev/null; then ${pushWith("FORK_TOKEN", "FORK_REMOTE", "refs/notes/appmarket:refs/notes/appmarket")} 2>/dev/null || true; fi`,
	`echo "${MARKER}STATUS=rebased"`,
].join("\n");

/** Env: MAIN_REMOTE, MAIN_TOKEN (write), FORK_REMOTE, FORK_TOKEN (read), BASE, FORK_REF, HEAD_SHA, BASE_SHA. */
export const pushScript = [
	...prelude,
	fetchWith("FORK_TOKEN", "FORK_REMOTE", "+$FORK_REF:refs/heads/checked"),
	`if [ "$(git rev-parse refs/heads/checked)" != "$HEAD_SHA" ]; then echo "${MARKER}STATUS=changed"; exit 0; fi`,
	fetchWith("MAIN_TOKEN", "MAIN_REMOTE", "+refs/heads/$BASE:refs/remotes/main/base"),
	`if [ "$(git rev-parse refs/remotes/main/base)" != "$BASE_SHA" ]; then echo "${MARKER}STATUS=base_moved"; exit 0; fi`,
	`if ! ${pushWith("MAIN_TOKEN", "MAIN_REMOTE", "$HEAD_SHA:refs/heads/$BASE")} 2>/dev/null; then echo "${MARKER}STATUS=base_moved"; exit 0; fi`,
	`echo "${MARKER}STATUS=merged"`,
	// Notes: the repo's own, plus the fork's (which hold the rebased commits' records).
	`if ${fetchWith("FORK_TOKEN", "FORK_REMOTE", "+refs/notes/appmarket:refs/notes/fork")} 2>/dev/null; then`,
	"  for attempt in 1 2 3; do",
	`    ${fetchWith("MAIN_TOKEN", "MAIN_REMOTE", "+refs/notes/appmarket:refs/notes/appmarket")} 2>/dev/null || git update-ref -d refs/notes/appmarket 2>/dev/null || true`,
	"    if git rev-parse -q --verify refs/notes/appmarket >/dev/null; then git notes --ref=appmarket merge -q -s ours refs/notes/fork; else git update-ref refs/notes/appmarket refs/notes/fork; fi",
	`    if ${pushWith("MAIN_TOKEN", "MAIN_REMOTE", "refs/notes/appmarket:refs/notes/appmarket")} 2>/dev/null; then echo "${MARKER}NOTES=pushed"; break; fi`,
	"  done",
	"fi",
].join("\n");

export interface MergeMarkers {
	status: string | null;
	base: string | null;
	head: string | null;
	map: [string, string][];
	conflicts: string[];
	notes: boolean;
}

export function parseMarkers(stdout: string): MergeMarkers {
	const out: MergeMarkers = { status: null, base: null, head: null, map: [], conflicts: [], notes: false };
	const sha = /^[0-9a-f]{40}$/;
	for (const line of stdout.split("\n")) {
		if (!line.startsWith(MARKER)) continue;
		const [key, ...rest] = line.slice(MARKER.length).split("=");
		const value = rest.join("=").trim();
		if (key === "STATUS") out.status = value;
		else if (key === "BASE" && sha.test(value)) out.base = value;
		else if (key === "HEAD" && sha.test(value)) out.head = value;
		else if (key === "CONFLICT" && value) out.conflicts.push(value);
		else if (key === "NOTES") out.notes = value === "pushed";
		else if (key === "MAP") {
			const [a, b] = value.split(" ");
			if (a && b && sha.test(a) && sha.test(b)) out.map.push([a, b]);
		}
	}
	return out;
}
