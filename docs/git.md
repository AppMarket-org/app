# Git

Every repo has a Git remote on appmarket.org:

```
https://appmarket.org/<owner>/<repo>.git
```

It speaks Git's smart HTTPS protocol, so `git clone`, `fetch` and `push` work as usual. SSH is not
offered: the repos are stored in Cloudflare Artifacts, which only serves HTTPS.

## Who can do what

- **Clone and fetch:**
  - published free repos: anyone, without signing in;
  - paid apps: their buyers;
  - unpublished repos: their owners and org members (and admins).
- **Push:** the repo's owners and org members. Everyone else forks, pushes to the fork, and opens
  a pull request.

## Signing in

The easiest way is the CLI, set up once:

```
npm i -g appmarket
appmarket login
appmarket setup-git
```

After that, plain `git clone`, `git fetch` and `git push` sign in by themselves:
- for appmarket.org remotes, Git asks `appmarket git-credential`, which answers with your sign-in;
- other credential helpers are cleared for this host only, so nothing lands in your keychain;
- `appmarket setup-git --remove` undoes it.

Without the CLI, Git asks for a username and password. Use any username, and as the password:

- **The CLI's sign-in** (`appmarket login`): reading needs `repos:read`, pushing needs `git:write`.
  Logins from before `git:write` existed need `appmarket login` again to push.
- **A push token** from the repo's dashboard (**Push your code → Create push token**), valid for an
  hour. You can also send it as a header: `git -c http.extraHeader="Authorization: Bearer <token>"`.
- **An agent session's token**, set up by `appmarket session start`.

## After a push

When you push a branch other than the default branch, Git prints a link to open a pull request,
or to the one already open for that branch:

```
remote: Create a pull request for 'feature/score':
remote:   https://appmarket.org/you/app/pulls/new?source=you%2Fapp&branch=feature%2Fscore
```

Pushes to a fork link to a pull request on the repo it was forked from.

## How it works

appmarket.org checks who you are and what you may do, then forwards Git's requests to the repo's
Artifacts remote with a short-lived token of its own. Neither the Artifacts host nor its tokens
reach the client. Remotes from before this change (`…artifacts.cloudflare.net/git/…`) keep working.

## Agent sessions

`appmarket session start` gives an agent its own sign-in for one repo (Git only, 8 hours, renewed
while the session is active). Its remote is the repo's URL with the session as the user name
(`https://agent-<id>@appmarket.org/<owner>/<repo>.git`), so Git uses the session's sign-in there
and yours everywhere else, even in the same checkout.

Every push from a session goes through appmarket.org's Git endpoint, which checks it before
anything reaches the repo:

- any branch may be created or updated, except protected ones: the default branch, and the names
  or `prefix/*` patterns in **Settings → Pull requests → Protected branches**;
- tags are refused;
- a session may delete only branches it created.

A refused push fails as usual in Git, with the reason:

```
! [remote rejected] main -> main (protected branch; push your own branch and open a pull request)
```

The agent opens a pull request for its branch; merging stays with the repo's owners and members.
Ending a session revokes its sign-in; discarding it also deletes the branches it created.

These rules guard the agent's normal workflow. An agent runs as you on your machine, so they are
not a sandbox: it could use your own `appmarket` sign-in if it went looking for it.
