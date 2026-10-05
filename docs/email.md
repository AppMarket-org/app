# Email

appmarket.org sends notification email through
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/), from a Worker binding
(`EMAIL`). There is no API key or secret.

## What is sent

- **Security notices** (#69 impacts): when an admin files a vulnerable package or a conformance
  rule, the owners of each newly affected repo get one email listing their affected repos with
  what to do. For org-owned repos, the org's owners get it.
  - Each affected repo is emailed once.
  - Repos affected for more than 7 days before email was turned on are not emailed.
  - Agent-session forks are skipped.

Users turn these off in **Settings → Email**, or with the link at the bottom of each email. Every
email also carries one-click unsubscribe headers (`List-Unsubscribe`, RFC 8058), which Gmail and
Yahoo require. Unsubscribe links are signed per user, so they work without signing in and cannot
be forged.

## Turning it on (owner)

Sending is off in an environment while its `emailFrom` in `apps/api/environments.ts` is empty
(staging and production start empty). Local development uses the simulated binding: messages are
written under `apps/api/.cloudflare/tmp/email/` and printed in the dev server log, never sent.

1. In the Cloudflare dashboard, go to **Compute → Email Service → Email Sending → Onboard Domain**
   and choose `appmarket.org`. Cloudflare adds the DNS records on the `cf-bounce` subdomain (MX,
   SPF, DKIM) and a DMARC record. This usually takes 5 to 15 minutes.
2. Set `emailFrom: "notifications@appmarket.org"` for staging (and later production) in
   `apps/api/environments.ts`, merge, and deploy.

Sending to any address needs the Workers Paid plan. It costs $0.35 per 1,000 emails.

If the domain is not verified, or a sending limit is hit, the run stops and logs `email.stopped`.
Nothing is marked as sent, so the next minute's run tries again.
