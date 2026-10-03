# PRD D6: build image for one-click deploys. Wrangler is installed here, outside any repo's
# node_modules, so the deploy step runs a Wrangler the repo cannot replace.
FROM docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5
RUN npm install --global wrangler@4.147.0 && npm cache clean --force
