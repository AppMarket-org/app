import { describe, expect, it } from "vitest";
import { checkPwa, pwaManifestCandidates } from "./pwa";

const manifest = (over: Record<string, unknown> = {}) =>
	JSON.stringify({ name: "Todo", start_url: "/", display: "standalone", icons: [{ src: "/i192.png", sizes: "192x192" }, { src: "/i512.png", sizes: "512x512" }], ...over });

describe("PWA check (#32)", () => {
	it("passes a manifest with icons plus a service worker", () => {
		const r = checkPwa(["public/manifest.webmanifest", "public/sw.js", "src/main.ts"], new Map([["public/manifest.webmanifest", manifest()]]));
		expect(r).toMatchObject({ installable: true, manifest: "public/manifest.webmanifest", name: "Todo", display: "standalone", serviceWorker: "public/sw.js", issues: [] });
	});

	it("explains what is missing", () => {
		const r = checkPwa(["manifest.json"], new Map([["manifest.json", manifest({ display: "browser", icons: [] })]]));
		expect(r.installable).toBe(false);
		expect(r.issues.join(" ")).toMatch(/display.*standalone/);
		expect(r.issues.join(" ")).toMatch(/192×192/);
		expect(r.issues.join(" ")).toMatch(/service worker/);
		expect(checkPwa(["src/index.ts"], new Map()).issues[0]).toMatch(/No web app manifest/);
	});

	it("counts PWA tooling as a service worker and ignores extension manifests and build output", () => {
		const pkg = JSON.stringify({ devDependencies: { "vite-plugin-pwa": "^1" } });
		expect(checkPwa(["package.json"], new Map([["package.json", pkg]])).installable).toBe(true);
		const ext = checkPwa(["manifest.json", "sw.js"], new Map([["manifest.json", JSON.stringify({ manifest_version: 3, name: "Ext" })]]));
		expect(ext.manifest).toBeNull();
		expect(pwaManifestCandidates(["dist/manifest.json", "node_modules/x/manifest.json", "public/manifest.json"])).toEqual(["public/manifest.json"]);
	});
});
