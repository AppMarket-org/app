---
title: "Agent memory"
description: "Notes a repo keeps for the next agent session, shared by every agent and every vendor."
---

Each repo keeps a memory: short notes on its commands, decisions and traps, for people and for the
next agent session. Open it from the repo's **Memory** tab.

## How agents use it

In any appmarket repo, `memory_recall`, `memory_remember`, `memory_update` and `memory_forget`
read and keep the repo's memory: short notes about its conventions, decisions and traps, shared by
its people and agents across sessions and vendors. Notes are redacted on your machine before they
are sent (and again on the server); pinned notes come first. With the Claude Code or Codex adapter (or the Claude Code
plugin), each session starts with the repo's memory in its context: pinned notes first, then the
most recent, within about 4,000 characters, followed by what the latest three agent sessions in the
repo did (any vendor: what was asked, the result, commits and files), so a Codex session can pick
up where a Claude Code session stopped. `session_history` gives more. Offline or signed out,
sessions start without it.

From the CLI: `appmarket memory list`, `appmarket memory add "Run pnpm test before pushing" --pin`,
and `appmarket memory export` to write it into a section of `AGENTS.md` for tools that read that
file.

## Suggestions from checkpoints

After agent sessions, appmarket.org suggests notes from their checkpoints: commands that worked,
gotchas the agent ran into, conventions it followed. Each suggestion links to its commit;
nothing is saved to memory until a person accepts it.

## Rules

Short notes a repo keeps for the next agent session and for people: commands, decisions, gotchas.
Each note is up to 1,000 characters, with up to 10 tags, and can be pinned.

- **Who:** the repo's owners and org members (and admins). Notes are never public.
- **Secrets:** redacted on the server with the same patterns as checkpoints (the CLI redacts
  first). A note shows how many redactions were made.
- **History:** every create, update and delete is kept with who made it, from where (`web`, `cli`,
  or a harness such as `claude-code`) and the agent session. Deleting hides a note, and its
  history stays.
- **Limits:** 500 notes per repo; writes are rate limited per user (60 a minute).
- **Removed repos:** their memory and its history are deleted with their checkpoints.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/repos/:owner/:repo/memory?q=&tag=&pinned=true&limit=` | Notes, pinned first, then most recently updated |
| POST | `/api/repos/:owner/:repo/memory` | `{ text, tags?, pinned?, source?, session? }` |
| GET, PATCH, DELETE | `/api/repos/:owner/:repo/memory/:id` | One note; PATCH takes any of `text`, `tags`, `pinned` |
| GET | `/api/repos/:owner/:repo/memory/:id/history` | Its changes, newest first |

Device tokens need `memory:read` to read and `memory:write` to write. CLI logins get both; CI tokens
get `memory:read` only. Logins from before memory existed need `appmarket login` again.

