/**
 * #73: the shell script that brings a template's new version into a fork, in a fresh container
 * that never runs either repo's code. Tokens arrive as env vars and go to Git as a header, never
 * into a URL, config or output.
 *
 * Fetches the template's tag and the fork's default branch; when the fork already contains the
 * version, says so; otherwise pushes it to the fork as a branch for a pull request.
 * Env: UP_REMOTE, UP_TOKEN (read), FORK_REMOTE, FORK_TOKEN (write), TAG, BASE, BRANCH.
 */
import { MARKER } from "../plane/merge-commands.ts";

const fetchWith = (header: string, remote: string, refspec: string) => `git -c http.extraHeader="Authorization: Bearer $${header}" fetch -q "$${remote}" "${refspec}"`;
const pushWith = (header: string, remote: string, refspec: string) => `git -c http.extraHeader="Authorization: Bearer $${header}" push -q "$${remote}" "${refspec}"`;

export const syncScript = [
	"set -eu",
	'dir=$(mktemp -d) && mkdir "$dir/repo" && cd "$dir/repo" && git init -q .',
	"git config core.hooksPath /dev/null",
	`if ! ${fetchWith("UP_TOKEN", "UP_REMOTE", "+refs/tags/$TAG:refs/tags/upstream")} 2>/dev/null; then echo "${MARKER}STATUS=no_tag"; exit 0; fi`,
	'version=$(git rev-parse "refs/tags/upstream^{commit}")',
	`echo "${MARKER}HEAD=$version"`,
	`if ! ${fetchWith("FORK_TOKEN", "FORK_REMOTE", "+refs/heads/$BASE:refs/remotes/fork/base")} 2>/dev/null; then echo "${MARKER}STATUS=no_branch"; exit 0; fi`,
	'base=$(git rev-parse refs/remotes/fork/base)',
	`echo "${MARKER}BASE=$base"`,
	`if git merge-base --is-ancestor "$version" "$base"; then echo "${MARKER}STATUS=current"; exit 0; fi`,
	pushWith("FORK_TOKEN", "FORK_REMOTE", "+$version:refs/heads/$BRANCH"),
	`echo "${MARKER}STATUS=pushed"`,
].join("\n");
