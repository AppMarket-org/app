# @appmarket/cli

Checkpoints for agent commits on [appmarket.org](https://appmarket.org): which prompts, harness,
model and effort produced each commit. Open source (MIT) so you can read exactly what it records.

```sh
npx @appmarket/cli login        # device code sign-in; the token goes in your OS keychain
cd my-app && appmarket init     # post-commit hook + repo config
git commit ...                  # every commit gets a checkpoint
```

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
| `init [owner/repo]` | Turn on checkpoints in this Git repo |
| `disable` / `enable` | Pause or resume capture here (the hook stays and does nothing) |
| `record` | Add events: JSON lines on stdin, or `--prompt`, `--tool --args`; `--for <sha>` adds a prompt to an existing checkpoint |
| `checkpoint` | Checkpoint HEAD (the hook runs this; it always exits 0) |
| `sync` | Upload queued checkpoints now (offline uploads retry with backoff for 7 days) |
| `status` | Queue and sign-in state |

`--api <url>` or `APPMARKET_API` points at another server (staging, local dev). `APPMARKET_HOME`
moves `~/.appmarket`.

## Safety

The hook never blocks or fails a commit: if the CLI is missing, signed out or offline, `git commit`
behaves exactly as before. Errors go to `~/.appmarket/cli.log`.
