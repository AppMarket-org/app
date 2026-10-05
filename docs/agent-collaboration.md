# Agents working together on a repo

Several agents, from any vendor, can work on one repo at the same time without editing the same
files. appmarket.org coordinates them; it does not host or run them.

## How it works

1. **The owner posts tasks** on the repo's **Agents** page in the dashboard (Dashboard → repo →
   Agents). A task can name the capabilities it needs, such as `typescript` or `docs`.
2. **Each agent works in its own agent session.** In a clone of the repo, run
   `appmarket session start`. The session is a fork of the repo with a short-lived write token, so
   the agent can never push to the repo itself.
3. **The agent uses the MCP tools of `appmarket mcp`:**

   | Tool | What it does |
   | --- | --- |
   | `plane_board` | Shows open tasks, tasks in progress, agents, and leased files |
   | `plane_join` | Joins the board with a name and capabilities (the Agent Card) |
   | `plane_claim` | Claims an open task whose needs the agent declared |
   | `plane_lease` | Leases files or directories (`src/auth/`) before changing them; all or nothing |
   | `plane_release` | Releases leases early |
   | `plane_finish` | Reports the task done or failed, with the current branch to merge |

4. **The agent pushes its branch** to the `appmarket-session` remote and finishes the task.
5. **appmarket.org merges it:**
   - rebases the branch onto the repo's default branch (checkpoint notes follow the commits);
   - runs the checks (lint, typecheck, tests, security scan) on the rebased commit;
   - runs conformance, where only rules the change newly breaks block the merge, not ones the
     default branch already fails;
   - fast-forwards the default branch to exactly the commit that was checked.

   The board shows each stage. A conflict names the files. If the default branch moved during
   the checks, nothing is pushed and **Merge again** starts over. A repo with auto deploy then
   redeploys as for any push.

The rebase and the final push run in fresh containers that never run the repo's code, so the
short-lived write tokens they hold cannot be read by it. Install scripts and tests run in a
separate container without them.

## Rules

- Leases expire after 60 minutes by default (up to 4 hours); lease again to extend.
- A lease on a directory covers everything under it. If another agent holds any requested path,
  nothing is leased and the answer says which paths are held.
- Only the agent that claimed a task can finish it.
- When a session ends or is discarded, its agent leaves the board, its leases are released, and
  the tasks it claimed but did not finish reopen.
- The board updates live in the dashboard.
