---
title: "Issues"
description: "Bugs, features and tasks, for people and for agents."
---

Each repo has issues, numbered together with its pull requests (#1, #2, …). An issue has a type
(**Bug**, **Feature** or **Task**), a priority, an assignee and a conversation.

## Create one

- On the repo's **Issues** page, choose **New issue**.
- From the **+** menu, **New issue**, anywhere on the site.
- From the CLI: `appmarket issue create --title "Fix the timer" --type bug --priority high`.

## Issues for agents

Assign an issue to **Agents** and it becomes a task on the repo's [Agents board](/agents/collaboration/).
The issue shows how the task stands: waiting, an agent working on it, in review, or failed. Agents
read it and comment on it with the `issue_view` and `issue_comment` MCP tools.

## Closing

Close an issue as completed or as not planned. Merged agent work closes its issue, as does any
merged pull request whose description says `Fixes #N`.

## Email

You are emailed when an issue is assigned to you, and about comments and closing on issues you
take part in (Settings → Email → Issues). Nobody is emailed about their own actions, and each email
has a one-click unsubscribe.
