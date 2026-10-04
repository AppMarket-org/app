# Checkpoint git notes (spike for #123, 2026-10-04)

**Question:** can appmarket.org write `refs/notes/appmarket` on the server, so developers who never
push notes still get them?

**Answer: no; the CLI pushes them.** Tested against the real Artifacts binding (local dev,
`dev: { remote: true }`) with `dev/hello-deploy`:

| Test | Result |
| --- | --- |
| Write a ref or object through the binding | Not possible: `ArtifactsRepo` has no write methods (read, log, fork, tokens, info only) |
| `git push origin refs/notes/appmarket` with a repo write token | Accepted |
| Binding `readFile({ ref: "refs/notes/appmarket", path: <sha> })` | `null`: refs are resolved for branches, tags and SHAs only, not `refs/notes/*` |
| Binding `readFile({ ref: <notes commit SHA>, path: <sha> })` | The note, byte for byte the same as `git notes show` locally |
| `fork()` with `defaultBranchOnly` true and false, then the same read in the fork | The note in both |

**Decision (fallback from the issue):**

- The CLI writes the note locally on each commit (unchanged) and, in the background,
  `appmarket push-notes` pushes `refs/notes/appmarket` to the repo's appmarket remote with the
  credentials git already has for it (no prompts; failures go to `~/.appmarket/cli.log`; opt out
  with `git config appmarket.pushNotes false`).
- If another machine pushed notes first, the CLI fetches them into
  `refs/notes/remotes/<remote>/appmarket`, merges (`-s ours`: this machine's record wins for the
  same commit, everything else is combined) and pushes again.
- The server does not need the notes: D1 holds the same record (uploaded by the CLI). If a server
  reader is ever needed, the CLI would have to report the notes commit SHA, since the binding cannot
  resolve the notes ref by name.
