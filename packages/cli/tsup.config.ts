import { defineConfig } from "tsup";

// One file to publish: shared types and constants are bundled; the keychain module stays external (native).
export default defineConfig({
	entry: { appmarket: "src/index.ts" },
	format: ["esm"],
	outExtension: () => ({ js: ".mjs" }),
	platform: "node",
	target: "node20",
	noExternal: ["@appmarket/shared"],
	external: ["@napi-rs/keyring"],
	banner: { js: "#!/usr/bin/env node" },
	clean: true,
});
