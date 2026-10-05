# Container apps (#54, R27)

Apps that need a full runtime (Node servers, Go, Java, Ruby, PHP, standard Python) run as
[Cloudflare Containers](https://developers.cloudflare.com/containers/) behind a Worker in the
buyer's account. The buyer needs the **Workers Paid** plan; Cloudflare bills container time to them.

## Spike result (2026-10-04)

- appmarket.org deploys through its own pipeline (Path B: OAuth + build container), not the
  public Deploy to Cloudflare button, so the button question does not apply: container apps are
  Path B only.
- The build container has no Docker daemon, so it cannot build images. It does not need to:
  when a Wrangler `containers[].image` is a **registry reference** (Docker Hub, Amazon ECR,
  Google Artifact Registry or Cloudflare's registry), `wrangler deploy` needs no Docker and
  Cloudflare pulls the image
  ([image management](https://developers.cloudflare.com/containers/platform-details/image-management/)).
- An image in the developer's own Cloudflare registry is not reachable from the buyer's account,
  so only Docker Hub, ECR and Artifact Registry are accepted.

## Rules (template contract, D2)

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
