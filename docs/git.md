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

Git asks for a username and password when it needs them. Use any username, and as the password:

- **The CLI's sign-in** (`appmarket login`): reading needs `repos:read`, pushing needs `git:write`.
  Logins from before `git:write` existed need `appmarket login` again to push.
- **A push token** from the repo's dashboard (**Push your code → Create push token**), valid for an
  hour. You can also send it as a header: `git -c http.extraHeader="Authorization: Bearer <token>"`.
- **An agent session's token**, set up by `appmarket session start`.

## How it works

appmarket.org checks who you are and what you may do, then forwards Git's requests to the repo's
Artifacts remote with a short-lived token of its own. Neither the Artifacts host nor its tokens
reach the client. Remotes from before this change (`…artifacts.cloudflare.net/git/…`) keep working.
