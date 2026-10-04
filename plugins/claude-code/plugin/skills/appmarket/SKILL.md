---
name: appmarket
description: Use when the user asks about appmarket.org checkpoints, the appmarket CLI, recording or publishing the prompts behind commits, build history, or setting up a repo on appmarket.org ("set up checkpoints", "why is my prompt not on appmarket", "make this checkpoint public", "appmarket login").
---

# appmarket.org checkpoints

appmarket.org attaches a **checkpoint** to every commit in a repo the user set up: the prompts
that led to it, the harness (Claude Code), model, effort setting, tool calls, token usage and the
files changed. This plugin's hooks feed that record; the `appmarket` CLI does the rest.

## Set up (the user runs these; they need a browser for sign-in)

```sh
npx @appmarket/cli login          # device code: open the URL, enter the code
cd <repo> && appmarket init       # or: appmarket init <owner>/<repo>
```

`appmarket init` installs a post-commit hook. From then on, each commit gets a checkpoint, written
as a git note (`git log --notes=appmarket`) and uploaded in the background. If the CLI is not
installed, the hooks do nothing and commits work as usual.

## What is recorded, and who sees it

- Only sessions working in a repo where `appmarket init` ran. Nothing from other projects.
- Prompts, tool names with their command or repo-relative path, the model, Claude Code version,
  effort setting, token usage and the assistant's last message before the commit.
- Secrets are replaced with `[redacted:<kind>]` **on the machine before upload**: known key formats,
  values from the repo's `.env*` files, custom patterns (`.appmarket.json`), and paths listed in
  `.appmarketignore`.
- New checkpoints are **private**: only the user (and their organization) see them. The user can
  publish individual checkpoints or sessions in the dashboard
  (appmarket.org/dashboard/repos/<owner>/<repo>/checkpoints); published ones appear on the app's
  build history.

## Helping the user

- Check state: `appmarket status` (sign-in and queued uploads), `appmarket whoami`.
- A commit without a captured prompt: `appmarket record --for <sha> --prompt "…"` adds one.
- Pause recording in this repo: `appmarket disable`; resume: `appmarket enable`.
- Offline commits are queued and uploaded later; `appmarket sync` sends them now.
- Never run `appmarket login` for the user or handle their token; it is their sign-in.
- Do not commit with `--no-verify` to avoid checkpoints; if the user does not want a commit
  recorded, they can delete its checkpoint in the dashboard.
