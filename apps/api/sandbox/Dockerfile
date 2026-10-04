# PRD D6: build image for one-click deploys. Wrangler is installed here, outside any repo's
# node_modules, so the deploy step runs a Wrangler the repo cannot replace.
FROM docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5
RUN npm install --global wrangler@4.147.0 && npm cache clean --force

# #87: Rust Workers. Minimal toolchain with the wasm target and worker-build preinstalled, so a
# repo's `cargo install -q "worker-build@^0.8"` build command finds it. gcc and OpenSSL headers
# are needed by build scripts and by worker-build itself.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev pkg-config libssl-dev && rm -rf /var/lib/apt/lists/* \
	&& curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown --no-modify-path \
	&& cargo install -q "worker-build@^0.8" \
	&& rm -rf /usr/local/cargo/registry /usr/local/cargo/git \
	&& chmod -R a+rwX /usr/local/cargo /usr/local/rustup

# #87: Python Workers. uv with the Python pywrangler uses, and pywrangler (workers-py) to vendor
# packages into python_modules/.
ENV UV_TOOL_BIN_DIR=/usr/local/bin UV_TOOL_DIR=/opt/uv/tools UV_PYTHON_INSTALL_DIR=/opt/uv/python
RUN curl -LsSf https://astral.sh/uv/0.12.23/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
	&& uv python install 3.14 \
	&& uv tool install workers-py==1.17.6 \
	&& uv cache clean \
	&& chmod -R a+rwX /opt/uv
