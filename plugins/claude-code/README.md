# appmarket.org plugin for Claude Code

Records the prompt, model, effort and tools behind every commit Claude Code makes in your
[appmarket.org](https://appmarket.org) repos, and attaches it to the commit as a checkpoint. Each
session starts with the repo's memory (notes its people and agents keep), and the `appmarket` MCP
server adds tools for memory, issues, pull requests and the Agents board.

```sh
claude plugin marketplace add AppMarket-org/claude-plugin
claude plugin install appmarket@appmarket
npx appmarket login
cd my-app && appmarket init
```

The plugin only adds hooks, a skill and the MCP server entry; the open-source [`appmarket`](https://www.npmjs.com/package/appmarket)
does the recording, redaction (on your machine, before upload) and upload. Without the CLI the hooks
do nothing. New checkpoints are private until you publish them.

This repository is generated from `plugins/claude-code` in the appmarket.org monorepo.
