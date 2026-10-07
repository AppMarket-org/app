---
title: "Privacy and data"
description: "What appmarket.org and its CLI record, who sees it, and what never leaves your machine."
---

## Checkpoints

- Recorded only in repos where you ran `appmarket init`, and only by adapters you installed.
- Secrets are redacted **on your machine** before anything is written or sent, and again on the
  server. See [Checkpoints](/agents/checkpoints/#redaction-happens-on-your-machine).
- New checkpoints are private: prompts are visible only to the repo's owners and members until you
  choose otherwise.

## Contributions on your profile

Your contribution graph and activity show your work in the repos each viewer can open: you see all
of yours, members of an organization see your work in its repos, and everyone else sees published
repos only. In Settings → Privacy you can also show the rest as anonymous counts, or hide your
activity.

## Memory

Repo memory is visible only to the repo's owners and members, never public, and redacted like
checkpoints.

## Deployments

Apps deploy into **your** Cloudflare account. appmarket.org keeps its Cloudflare tokens encrypted,
never stores your secret values (they go straight to Cloudflare), and you can disconnect or eject
at any time.

## The CLI itself

No telemetry. The only request besides your own uploads is a daily check of the npm registry for a
newer version (a one-line notice; it never updates itself). `APPMARKET_NO_UPDATE_CHECK=1` turns it off.
