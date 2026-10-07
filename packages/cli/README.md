# appmarket

Checkpoints for agent commits on [appmarket.org](https://appmarket.org): which prompts, harness,
model and effort produced each commit. Open source (MIT) so you can read exactly what it records.

```sh
npx appmarket login                      # device code sign-in; the token goes in your OS keychain
appmarket adapter install claude-code    # once per machine: record Claude Code sessions (or: codex, opencode, cursor)
cd my-app && appmarket init              # post-commit hook + repo config
git commit ...                           # every commit gets a checkpoint
```

### Without Node

Each release on [GitHub](https://github.com/AppMarket-org/app/releases) also has standalone binaries
for macOS (arm64, x64) and Linux (x64, arm64); no Windows binary yet (use npm there). They are not
code-signed. Check one before running it:

```sh
gh attestation verify appmarket-darwin-arm64 --repo AppMarket-org/app   # built by this repo's release workflow
shasum -a 256 -c SHA256SUMS --ignore-missing                            # or compare the checksum
chmod +x appmarket-darwin-arm64 && xattr -d com.apple.quarantine appmarket-darwin-arm64   # macOS only
mv appmarket-darwin-arm64 /usr/local/bin/appmarket
```

## Claude Code

`appmarket adapter install claude-code` adds hooks to `~/.claude/settings.json` (a backup is kept
next to it; `uninstall` removes only these hooks). They record, for sessions working in a repo where
you ran `appmarket init` and nowhere else:

- each prompt you send, and each tool call (name, plus the command or file path relative to the repo)
- at commit time, from the session transcript: model, Claude Code version, effort setting, token
  usage (thinking tokens separately)
- when the turn ends (the `Stop` hook): the agent's final reply, as the summary of the commits it
  made in that turn (agents usually commit first and sum up afterwards)

Installed before CLI 0.9.0? Run `appmarket adapter install claude-code` again to add the `Stop`
hook (or update the plugin to 0.3.0).

When an agent runs `git commit`, the hook also makes the checkpoint itself, so commits are recorded
even where the git hook is missing. Hook failures never interrupt Claude Code; they go to
`~/.appmarket/cli.log`.

## Codex

`appmarket adapter install codex` adds three hooks to `~/.codex/hooks.json` (SessionStart,
UserPromptSubmit, PostToolUse; other hooks there are kept). Codex runs user hooks only after you
review them once: open Codex and run `/hooks`. Prompts and tool calls (shell commands, and the
files an `apply_patch` touched) come from the hooks; model, Codex version, `model_reasoning_effort`,
token usage (reasoning tokens separately) and the final message come from the session's rollout
file at commit time.

## OpenCode

`appmarket adapter install opencode` writes a plugin to `~/.config/opencode/plugins/appmarket.ts`
and adds the `appmarket mcp` server to `~/.config/opencode/opencode.json` (other settings and MCP
servers are kept; with only an `opencode.jsonc`, it prints the entry to add). The plugin forwards
OpenCode's events as they happen: prompts (not the task tool's subagent prompts), tool calls with
their outcome, the model and variant (effort), token usage and cost per model call, and the final
message. Each event goes to a detached `appmarket hook opencode`, so OpenCode never waits for it.
Usage of the model call that ran `git commit` arrives just after the commit, so it counts toward
the next checkpoint. The final message becomes the summary of the commits made in that turn.

## Cursor

`appmarket adapter install cursor` adds hooks to `~/.cursor/hooks.json` (with `--project`: the
repo's `.cursor/hooks.json`; other hooks there are kept). Restart Cursor to load them. Prompts,
tool calls (with their outcome), the model, the reasoning-effort setting, Cursor's version and the
final answer come from the hooks (the final answer becomes the summary of the commits made in that
turn); Cursor gives hooks no token usage, so its checkpoints have none.
An agent's `git commit` makes the checkpoint right away, and the repo's memory is added at session
start. Hooks that fail never block Cursor (it fails open, and the hook always exits 0).

## Other agents (MCP)

Agents without a hook adapter (Gemini CLI, Aider, and others for now) report their own prompt
through MCP: add the server `appmarket mcp` (stdio) to the agent, and `appmarket init` adds one line
to `AGENTS.md` (or `CLAUDE.md`) asking it to call `record_context(prompt, summary)` before each
commit. These checkpoints are labelled **agent-reported**. When a hook adapter captured the same
work, its record wins. `appmarket init --agents-md` adds the line even when Claude Code is present.

## What it records, and where

- A buffer of agent events per repo in `~/.appmarket/sessions/` (written by harness adapters through
  `appmarket record`).
- On each commit: a checkpoint record (schema `appmarket.checkpoint/1`) as a local git note under
  `refs/notes/appmarket` (`git log` shows it), queued in `~/.appmarket/queue/` and uploaded to
  appmarket.org in the background. The notes ref is also pushed to the repo's appmarket remote
  (merged with notes from your other machines); `git config appmarket.pushNotes false` keeps it local.
- A checkpoint too large to store inline (over 256 KB) is uploaded trimmed, and its full
  record goes up separately; appmarket.org stores that encrypted with a key for your account.
- New checkpoints are **private** by default: only you (and members of the owning organization) see
  prompts. Others see the commit's metadata only.

## Redaction happens on your machine

Before anything is written to the note, the queue or the network, prompts, assistant text and tool
arguments are scanned and secrets replaced with `[redacted:<kind>]`:

- known key formats (Anthropic, OpenAI, Stripe, GitHub, AWS, Slack, Cloudflare, JWTs, bearer tokens,
  private keys, credentials in URLs)
- the values in this repo's `.env*` and `.dev.vars*` files (not `*.example`)
- your own patterns: `{"redact": ["ACME-[0-9]{6}"]}` in `~/.appmarket/config.json` or `.appmarket.json`
- tools touching `.env*`, keys and paths in `.appmarketignore` keep their name but lose their arguments

## Commands

| Command | |
| --- | --- |
| `login [--no-browser] [--device-name n] [--no-keychain]` | Sign in with a device code |
| `logout` | Revoke this device's token and forget it |
| `pr create [--title] [--body] [--base]` / `pr list [--state]` / `pr view [n]` / `pr merge [n]` | Pull requests for this branch: from a fork or agent session to the original repo, otherwise to the default branch |
| `issue create --title t [--type bug\|feature\|task] [--priority p] [--assign agents\|<handle>] [--body b]` | Open an issue; assigned to `agents`, it is a task on the Agents board |
| `issue list [--state] [--type] [--assign]` / `issue view <n>` / `issue comment <n> --body b` / `issue close <n> [--not-planned]` / `issue reopen <n>` | Issues of this repo (of the original repo from a fork or agent session) |
| `memory list [query] [--tag t]` / `memory add <text> [--tags a,b] [--pin]` / `memory remove <id>` / `memory export` | The repo's memory; `export` writes it into a section of AGENTS.md for tools that read that file |
| `setup-git [--remove]` | Let plain `git` sign in to appmarket.org remotes with this login (no tokens to copy, nothing in the keychain) |
| `whoami` | Account, device, scopes, expiry |
| `init [owner/repo] [--agents-md]` | Turn on checkpoints in this Git repo |
| `mcp` | MCP server (stdio): `record_context` for agents without hooks, the task board tools (`plane_*`), issues (`issue_*`), pull requests (`pr_*`), repo memory (`memory_*`, `session_history`) and the code graph tools (`code_*`); see below |
| `session start [owner/repo] [--harness h]` / `session end [id] [--discard]` / `session list` | Agent sessions: work in the repo on their own branches with a sign-in that renews itself; protected branches and tags are off limits |
| `disable` / `enable` | Pause or resume capture here (the hook stays and does nothing) |
| `record` | Add events: JSON lines on stdin, or `--prompt`, `--tool --args`; `--for <sha>` adds a prompt to an existing checkpoint |
| `checkpoint` | Checkpoint HEAD (the hook runs this; it always exits 0; skips commits that already have one unless `--force`) |
| `adapter install\|uninstall claude-code\|codex\|opencode\|cursor [--project]` | Add or remove the hooks for Claude Code, Codex or Cursor (`--project`: this repo only), or the OpenCode plugin |
| `sync` | Upload queued checkpoints now (offline uploads retry with backoff for 7 days) |
| `status` | Queued uploads, last upload, adapters, and this repo's checkpoints still waiting for a push (flags those older than 30 days) |
| `doctor` | Checks git hooks, sign-in, connection, and each adapter against the installed harness (reads its newest transcript) |

## Agents working together

In an agent session (`appmarket session start`), the MCP server also offers the repo's task board
on appmarket.org: `plane_board`, `plane_join`, `plane_claim`, `plane_lease`, `plane_release`,
`plane_finish`.

In any appmarket repo, `pr_open`, `pr_status`, `pr_comments` and `pr_reply` let an agent open a pull request
for its branch, follow its review and merge state, and answer reviewers. Board tasks are issues:
`plane_board` shows each one's number, type and priority (most urgent first), `issue_view` reads an
issue with its comments, and `issue_comment` reports progress or asks a question.

- Agents claim tasks the owner posted and lease the files they will change. A lease returns a
  heads-up when a file imports, or is imported by, one another agent holds.
- Finishing a task reports the branch the session pushed. appmarket.org rebases it,
  runs the checks and merges it.
- In any appmarket repo, `code_find_symbol`, `code_references` and `code_impact` answer where
  something is defined, who imports a file, and what a change can affect.

In any appmarket repo, `memory_recall`, `memory_remember`, `memory_update` and `memory_forget`
read and keep the repo's memory: short notes about its conventions, decisions and traps, shared by
its people and agents across sessions and vendors. Notes are redacted on your machine before they
are sent (and again on the server); pinned notes come first. With the Claude Code or Codex adapter (or the Claude Code
plugin), each session starts with the repo's memory in its context: pinned notes first, then the
most recent, within about 4,000 characters, followed by what the latest three agent sessions in the
repo did (any vendor: what was asked, the result, commits and files), so a Codex session can pick
up where a Claude Code session stopped. `session_history` gives more. Offline or signed out,
sessions start without it.

See [docs/agent-collaboration.md](https://github.com/AppMarket-org/app/blob/main/docs/agent-collaboration.md).

## CI

Create a CI token in Settings → Signed-in devices (same limited scopes as a CLI login, revocable
there). In the pipeline set it as the secret `APPMARKET_TOKEN` (used directly, nothing is
written), or run `appmarket login --token -` with the token on stdin.

`--api <url>` or `APPMARKET_API` points at another server (staging, local dev). `APPMARKET_HOME`
moves `~/.appmarket`.

## Rebase and amend

`init` also installs a `post-rewrite` hook: after `git rebase` or `git commit --amend`, each new
commit gets the original checkpoint with `rewritten_from` set (an amend also adds prompts recorded
since), and the old commit's checkpoint stays as history. Repos set up with an earlier version: run
`appmarket init` again.

## Privacy of the CLI itself

No telemetry. The only request besides your own uploads is a daily check of the npm registry for a
newer version (a one-line notice; it never updates itself). `APPMARKET_NO_UPDATE_CHECK=1` turns it off.

## Safety

The hook never blocks or fails a commit: if the CLI is missing, signed out or offline, `git commit`
behaves exactly as before. Errors go to `~/.appmarket/cli.log`.

## Releasing

Bump `version` in `package.json` and `VERSION` in `src/config.ts`, merge, then push a tag
`cli-v<version>`. The Release CLI workflow publishes to npm with provenance (trusted publishing,
no stored token).
