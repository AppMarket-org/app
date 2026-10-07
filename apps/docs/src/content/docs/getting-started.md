---
title: "Getting started"
description: "Sign in, create a repo, push your code, and record the context behind your first agent commit."
---

appmarket.org hosts Git repositories, records what your coding agents did for each commit, and
deploys apps into your own Cloudflare account. This page takes you from nothing to a pushed repo
with checkpoints.

## 1. Sign in

Go to [appmarket.org](https://appmarket.org) and sign in with Google or GitHub. Your handle is your
profile address: `appmarket.org/<handle>`.

## 2. Install the CLI

```sh
npm install -g appmarket        # Node 20+; or a standalone binary, see the CLI reference
appmarket login                 # device sign-in: approve the code in your browser
appmarket setup-git             # let plain git push to appmarket.org with this login
```

The token is stored in your OS keychain. `appmarket whoami` shows who you are signed in as.

## 3. Create a repo

From the **+** menu, choose **New repository**. Give it a name and a one-line summary; it starts
private, visible only to you (and your organization's members, for an organization repo). You can
also start from a public GitHub repository.

## 4. Push your code

```sh
git remote add origin https://appmarket.org/<handle>/<repo>.git
git push -u origin main
```

See [Repositories and Git](/git/repositories/) for who may clone and push.

## 5. Record checkpoints

Tell the CLI which coding agent you use, once per machine, then turn checkpoints on in the repo:

```sh
appmarket adapter install claude-code   # or: codex, opencode, cursor
appmarket init                          # in the repo: a post-commit hook and the repo's config
```

From now on every commit gets a [checkpoint](/agents/checkpoints/): the prompts, agent, model,
effort and usage behind it. Open the repo's **Checkpoints** tab, or **Commits** from the code view,
to see them.

## Next

- Let several agents [work together](/agents/collaboration/) on the repo.
- Give your agents a [memory](/agents/memory/) of the repo.
- [Publish](/apps/publish/) the repo as an app, and [deploy](/apps/deploy/) it to Cloudflare.
