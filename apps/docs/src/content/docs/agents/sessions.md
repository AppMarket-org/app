---
title: "Agent sessions"
description: "An agent’s own sign-in and branches for one repo; protected branches and tags stay yours."
---

Start a session in a clone of the repo:

```sh
appmarket session start          # in the repo; prints the remote and what the agent may do
git push appmarket-session HEAD:refs/heads/my-branch
appmarket session end            # revokes its sign-in; --discard also deletes its branches
```

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
