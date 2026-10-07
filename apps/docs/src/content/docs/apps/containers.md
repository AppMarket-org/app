---
title: "Container apps"
description: "Apps that run a Docker image on Cloudflare Containers."
---

A repo whose runtime is **Container** runs a Docker image on Cloudflare Containers next to its
Worker. Containers need the buyer's Workers Paid plan, and container time is billed to them.

## Rules

- `runtime: container` repos need a `containers` entry with `class_name` and `image`.
- `image` must be published to Docker Hub (`docker.io/...`), Amazon ECR or Google Artifact
  Registry and **pinned by digest** (`...@sha256:<64 hex>`), so the reviewed version is exactly
  what deploys. A Dockerfile path is refused at submit.
- A Durable Object binding should point at the container class (warning).
- The Dockerfile stays in the repo as the image's source (R26 runtime check).
- On deploy, the container application name is scoped to the buyer's Worker name, like D1/KV/R2.

## Publish the image from CI

```yaml
- uses: docker/login-action@v3
  with: { username: "${{ secrets.DOCKERHUB_USERNAME }}", password: "${{ secrets.DOCKERHUB_TOKEN }}" }
- id: push
  uses: docker/build-push-action@v6
  with: { context: ., push: true, platforms: linux/amd64, tags: "docker.io/you/app:${{ github.ref_name }}" }
- run: echo "image = docker.io/you/app:${{ github.ref_name }}@${{ steps.push.outputs.digest }}"
```

Put that `image` value in `wrangler.jsonc`, commit, tag the version and submit it. Cloudflare
Containers run `linux/amd64` images. The image must be public, or the buyer would need registry
credentials.

