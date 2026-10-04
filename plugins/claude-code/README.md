# appmarket.org plugin for Claude Code

Records the prompt, model, effort and tools behind every commit Claude Code makes in your
[appmarket.org](https://appmarket.org) repos, and attaches it to the commit as a checkpoint.

```sh
claude plugin marketplace add AppMarket-org/claude-plugin
claude plugin install appmarket@appmarket
npx @appmarket/cli login
cd my-app && appmarket init
```

The plugin only adds hooks and a skill; the open-source [`@appmarket/cli`](https://www.npmjs.com/package/@appmarket/cli)
does the recording, redaction (on your machine, before upload) and upload. Without the CLI the hooks
do nothing. New checkpoints are private until you publish them.

This repository is generated from `plugins/claude-code` in the appmarket.org monorepo.
