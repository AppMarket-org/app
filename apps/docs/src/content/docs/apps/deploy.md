---
title: "Deploy to Cloudflare"
description: "Run an app in your own Cloudflare account, in one click, and manage it from appmarket.org."
---

Apps on appmarket.org deploy into **your** Cloudflare account. The app, its data and the bill are
yours; appmarket.org builds it and keeps it up to date with your permission.

## Connect your Cloudflare account

In your dashboard, open **Cloudflare account** and choose **Connect Cloudflare account**. Cloudflare
asks you to approve the permissions appmarket.org needs to create Workers, D1 databases, KV, R2
buckets and the other resources apps use. You can **Disconnect** at any time; appmarket.org then
revokes its tokens.

## Deploy

On an app's page, choose **Deploy to Cloudflare**. Before you start, the page shows **what
deploying creates** in your account (the Worker, databases, buckets) and which secrets you will be
asked for. appmarket.org then:

1. builds the app in a fresh container;
2. creates its resources in your account, named after your Worker so they never collide;
3. deploys the Worker and gives you its address.

The deployment page follows each step and shows the build and deploy logs.

## Manage it

Once it is live, the deployment page has:

- **Domains**: attach your own domain or subdomain. Cloudflare creates the DNS record and the
  certificate. The app's address then becomes your domain.
- **Variables and secrets**: change them; each change deploys a new version right away. Secret
  values go straight to Cloudflare; appmarket.org never stores or shows them.
- **Versions**: every upload of the Worker in your account, with one-click rollback.
- **Logs**: the deploy's output and the Worker's runtime logs.
- **Eject**: take the app's code and deploy it yourself with Wrangler. You keep the same Worker and
  data, and updates from the developer stop reaching you.

## Previews

Repo owners can deploy a branch as a preview into their own account, and have previews update on
every push.
