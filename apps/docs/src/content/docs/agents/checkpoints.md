---
title: "Checkpoints"
description: "The prompts, agent, model, effort and usage behind each commit, recorded on your machine and private by default."
---

A checkpoint is attached to a commit and records what produced it: the prompts you sent, the
coding agent and its version, the model, the reasoning effort, the tool calls, the token usage and
the agent's final message. People can read the history of an app the way they read its code.

```sh
appmarket adapter install claude-code   # once per machine (see Agent adapters)
appmarket init                          # once per repo
git commit -m "Add a daily board"       # this commit gets a checkpoint
git log --notes=appmarket               # see it locally
```

On appmarket.org, the repo's **Checkpoints** tab lists them by agent session, and **Commits** (from
the code view) shows each commit with the prompts behind it. Your profile's activity does the same
for your commits.

## Who sees the prompts

Each checkpoint is **private**, **on the app page**, or **public**; the repo sets the default for
new ones (Checkpoints → New checkpoints), and you can change a single checkpoint or a whole session.

- **Private:** only the repo's owners and members see the prompts. Others see that the commit was
  made with an agent (which one, which model) but not what was asked.
- **On the app page:** the prompts show in the app's build history.
- **Public:** anyone who can see the repo sees them.

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

## Rebase and amend

`init` also installs a `post-rewrite` hook: after `git rebase` or `git commit --amend`, each new
commit gets the original checkpoint with `rewritten_from` set (an amend also adds prompts recorded
since), and the old commit's checkpoint stays as history. Repos set up with an earlier version: run
`appmarket init` again.
