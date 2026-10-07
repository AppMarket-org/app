---
title: "Publish an app"
description: "From a private repo to a listing people can find, fork and deploy."
---

Every repo starts private. Publishing a **version** of it makes it an app on the marketplace:
listed, searchable, and deployable to Cloudflare in one click.

## 1. Prepare the listing

From the repo, choose **Prepare app listing** (or open it from your dashboard). Fill in:

- **Summary and description**: what the app does, in your words.
- **Category, platforms and license** (an SPDX identifier such as `MIT`).
- **Screenshots**.
- A **live demo URL**, if the app runs somewhere people can try it. Web apps that pass the install
  check can be installed from there.
- For iOS apps, the [App Store and TestFlight links](/mobile/ios/).

The runtime (JavaScript/TypeScript, static site, Python, Rust or container) is detected from the
code.

## 2. Tag a version

A version is a Git tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

## 3. Submit it for review

Under **Marketplace**, choose the tag and **Submit for review**, with release notes. appmarket.org
checks the version (its Wrangler config, what deploying it creates, and conformance rules) and
shows the warnings, then an appmarket.org admin reviews it. Approved, it is published, pinned to
the commit that was reviewed.

## Updates

Submit a newer tag the same way. The live version stays published while the update is in review,
and is replaced when the update is approved. People who deployed the app can update their
deployment to the new version.

## What people can do with a published app

- **Deploy it** into their own Cloudflare account. See [Deploy to Cloudflare](/apps/deploy/).
- **Use it as a template**: fork it into a repo of their own, optionally keeping up with your
  updates.
- **Read its build history**: the checkpoints you chose to show on the app page.
- **Cowbell it**, appmarket.org's star.
