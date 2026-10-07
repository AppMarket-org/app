# Contributing to appmarket.org

Thanks for helping build a Git platform for agents and humans. Bug reports, fixes, docs and new
features are all welcome, whether you wrote the code yourself or with a coding agent.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened instead.
  Screenshots and the URL help.
- **Small fixes** (typos, docs, an obvious bug): open a pull request straight away.
- **Bigger changes** (a new feature, a new dependency, an API or schema change): open an issue
  first, so we can agree on the approach before you spend time on it.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

Issues labelled `good first issue` are a good place to start.

## Set up

You need Node 22.18+ and pnpm.

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars    # fill in the values: docs/auth-setup.md
pnpm --filter @appmarket/api db:migrate             # local D1 database
pnpm dev                                            # API on :5173, web app on :4200 (proxies /api)
```

The [docs](docs) explain the architecture ([ADRs](docs/adr)), sign-in, Git, pull requests,
checkpoints and deploys.

## Make your change

- Branch from `main`, and keep one change per pull request.
- Add or update tests next to the code you change (Vitest; `*.test.ts` and `*.spec.ts`).
- Match the code around you: its naming, its comment style and how much it comments.
- Update the docs when behaviour changes.

Conventions the checks enforce:

- **Web app:** Angular with Angular Material components only, styles in separate SCSS files, sizes
  in `rem`, never `px` (`pnpm check:ui`).
- **No secrets in Git:** no tokens, keys or credentials in code, config, tests or docs
  (`pnpm check:secrets`, and gitleaks in CI). Local secrets go in `apps/api/.dev.vars`, which is
  ignored.
- **Database changes** are new numbered migrations in `apps/api/migrations`; never edit one that
  has shipped.

Before you push:

```sh
pnpm typecheck && pnpm test && pnpm check:secrets && pnpm check:ui && pnpm build
```

## Open a pull request

- Say what changed and why, and link the issue (`Fixes #123`).
- CI must pass. A maintainer reviews it and squash-merges it.
- Keep the PR focused. Unrelated clean-ups belong in their own PR.

## Sign your commits (DCO)

Every commit in a pull request needs a sign-off: a line certifying that you wrote the change or
otherwise have the right to submit it under the project's license, as described in the
[Developer Certificate of Origin](https://developercertificate.org/). Add it with `-s`:

```sh
git commit -s -m "Fix the search pager"
```

This adds `Signed-off-by: Your Name <you@example.com>`, matching the commit's author. CI checks
every commit in the pull request. Forgot? Sign the existing commits and force-push:

```sh
git rebase --signoff main
git push --force-with-lease
```

Agent-written commits are welcome. The person who sends the pull request signs off and is
responsible for the change, the same as for code they typed.

## License

By contributing, you agree that your contributions are licensed under the repository's licenses:
[Apache-2.0](LICENSE) for the platform, and [MIT](packages/cli/LICENSE) for code in `packages/cli`
and `plugins/claude-code`.
