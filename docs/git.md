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
