# @appmarket/cli

Checkpoints for agent commits on [appmarket.org](https://appmarket.org): which prompts, harness,
model and effort produced each commit. Open source (MIT) so you can read exactly what it records.

```sh
npx @appmarket/cli login                 # device code sign-in; the token goes in your OS keychain
appmarket adapter install claude-code    # once per machine: record Claude Code sessions
cd my-app && appmarket init              # post-commit hook + repo config
git commit ...                           # every commit gets a checkpoint
```

## Claude Code

`appmarket adapter install claude-code` adds hooks to `~/.claude/settings.json` (a backup is kept
next to it; `uninstall` removes only these hooks). They record, for sessions working in a repo where
you ran `appmarket init` and nowhere else:

- each prompt you send, and each tool call (name, plus the command or file path relative to the repo)
- at commit time, from the session transcript: model, Claude Code version, effort setting, token
  usage (thinking tokens separately) and the assistant's last message before the commit

When an agent runs `git commit`, the hook also makes the checkpoint itself, so commits are recorded
even where the git hook is missing. Hook failures never interrupt Claude Code; they go to
`~/.appmarket/cli.log`.

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
  appmarket.org in the background.
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
| `whoami` | Account, device, scopes, expiry |
| `init [owner/repo] [--agents-md]` | Turn on checkpoints in this Git repo |
| `mcp` | MCP server (stdio) with `record_context`, for agents without hooks |
| `disable` / `enable` | Pause or resume capture here (the hook stays and does nothing) |
| `record` | Add events: JSON lines on stdin, or `--prompt`, `--tool --args`; `--for <sha>` adds a prompt to an existing checkpoint |
| `checkpoint` | Checkpoint HEAD (the hook runs this; it always exits 0; skips commits that already have one unless `--force`) |
| `adapter install\|uninstall claude-code` | Add or remove the Claude Code hooks |
| `sync` | Upload queued checkpoints now (offline uploads retry with backoff for 7 days) |
| `status` | Queue and sign-in state |

`--api <url>` or `APPMARKET_API` points at another server (staging, local dev). `APPMARKET_HOME`
moves `~/.appmarket`.

## Safety

The hook never blocks or fails a commit: if the CLI is missing, signed out or offline, `git commit`
behaves exactly as before. Errors go to `~/.appmarket/cli.log`.
