import { defineConfig } from "vitest/config";

// Unit tests for pure modules (no Workers runtime). Kept separate from vite.config.ts,
// whose Cloudflare plugin evaluates cloudflare.config.ts.
export default defineConfig({
	test: { include: ["src/**/*.test.ts"] },
});
