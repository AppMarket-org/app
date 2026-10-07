---
title: "The appmarket CLI"
description: "Install it, sign in, and every command."
---

The `appmarket` CLI is open source (MIT): you can read exactly what it records.

## Install

```sh
npx appmarket login                      # device code sign-in; the token goes in your OS keychain
appmarket adapter install claude-code    # once per machine: record Claude Code sessions (or: codex, opencode, cursor)
cd my-app && appmarket init              # post-commit hook + repo config
git commit ...                           # every commit gets a checkpoint
```

### Without Node (standalone binaries)

Each release on [GitHub](https://github.com/AppMarket-org/app/releases) also has standalone binaries
for macOS (arm64, x64) and Linux (x64, arm64); no Windows binary yet (use npm there). They are not
code-signed. Check one before running it:

```sh
gh attestation verify appmarket-darwin-arm64 --repo AppMarket-org/app   # built by this repo's release workflow
shasum -a 256 -c SHA256SUMS --ignore-missing                            # or compare the checksum
chmod +x appmarket-darwin-arm64 && xattr -d com.apple.quarantine appmarket-darwin-arm64   # macOS only
mv appmarket-darwin-arm64 /usr/local/bin/appmarket
```

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

## CI

Create a CI token in Settings → Signed-in devices (same limited scopes as a CLI login, revocable
there). In the pipeline set it as the secret `APPMARKET_TOKEN` (used directly, nothing is
written), or run `appmarket login --token -` with the token on stdin.

`--api <url>` or `APPMARKET_API` points at another server (staging, local dev). `APPMARKET_HOME`
moves `~/.appmarket`.

## Safety

The hook never blocks or fails a commit: if the CLI is missing, signed out or offline, `git commit`
behaves exactly as before. Errors go to `~/.appmarket/cli.log`.
