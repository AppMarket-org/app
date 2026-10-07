---
title: "Agent adapters"
description: "How Claude Code, Codex, OpenCode, Cursor and any MCP agent are recorded."
---

One command per machine connects a coding agent; `appmarket init` in a repo turns recording on
there. Nothing is recorded in repos where you did not run `appmarket init`.

```sh
appmarket adapter install claude-code   # or: codex, opencode, cursor
appmarket doctor                        # checks each adapter against the installed agent
```

| Agent | Prompts | Tools | Model and effort | Token usage |
| --- | --- | --- | --- | --- |
| Claude Code | Hooks | Hooks | Session transcript | Yes, thinking tokens separately |
| Codex | Hooks | Hooks | Rollout file | Yes, reasoning tokens separately |
| OpenCode | Plugin | Plugin | Plugin | Yes, with cost |
| Cursor | Hooks | Hooks | Hooks | No (Cursor does not give hooks usage) |
| Any MCP agent | `record_context` | | Reported by the agent | |

## Claude Code

`appmarket adapter install claude-code` adds hooks to `~/.claude/settings.json` (a backup is kept
next to it; `uninstall` removes only these hooks). They record, for sessions working in a repo where
you ran `appmarket init` and nowhere else:

- each prompt you send, and each tool call (name, plus the command or file path relative to the repo)
- at commit time, from the session transcript: model, Claude Code version, effort setting, token
  usage (thinking tokens separately)
- when the turn ends (the `Stop` hook): the agent's final reply, as the summary of the commits it
  made in that turn (agents usually commit first and sum up afterwards)

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
