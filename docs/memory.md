# Repo memory

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
