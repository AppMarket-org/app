import type { PwaCheck } from "@appmarket/shared";

/**
 * #32 (M1): a static check that a version can be installed as a web app: a web app manifest with a
 * name, start URL, standalone-style display and 192/512 px icons, plus a service worker (a file, or
 * tooling that generates one at build time). Browsers decide in the end; this catches what is
 * clearly missing before review.
 */
const MANIFEST = /(^|\/)(manifest\.webmanifest|site\.webmanifest|app\.webmanifest|manifest\.json)$/;
const SERVICE_WORKER = /(^|\/)(sw|service-worker|serviceworker|service_worker|ngsw-worker)\.(js|mjs|ts)$/i;
const SW_TOOLING = ["@angular/service-worker", "vite-plugin-pwa", "@vite-pwa/sveltekit", "@vite-pwa/nuxt", "@vite-pwa/astro", "next-pwa", "@ducanh2912/next-pwa", "workbox-build", "workbox-webpack-plugin", "@serwist/next", "serwist"];
const IGNORED = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.wrangler)\//;
const STANDALONE = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/** Manifest candidates to read, most likely first (public/ and static/ folders before others). */
export function pwaManifestCandidates(paths: string[]): string[] {
	const score = (p: string) => (/^(public|static|src|app|www)\//.test(p) ? 0 : p.includes("/") ? 2 : 1);
	return paths.filter((p) => MANIFEST.test(p) && !IGNORED.test(p)).sort((a, b) => score(a) - score(b) || a.length - b.length).slice(0, 5);
}

export function checkPwa(paths: string[], files: Map<string, string>): PwaCheck {
	const issues: string[] = [];
	let found: { path: string; data: Record<string, unknown> } | null = null;
	for (const path of pwaManifestCandidates(paths)) {
		try {
			const data = JSON.parse(files.get(path) ?? "") as Record<string, unknown>;
			// A browser-extension manifest.json has manifest_version; it is not a web app manifest.
			if (data && typeof data === "object" && !("manifest_version" in data) && (data.name || data.short_name || data.icons)) {
				found = { path, data };
				break;
			}
		} catch {
			// Not JSON; try the next candidate.
		}
	}
	const pkg = (() => {
		try {
			const p = JSON.parse(files.get("package.json") ?? "{}") as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
			return { ...p.dependencies, ...p.devDependencies };
		} catch {
			return {};
		}
	})();
	const swFile = paths.find((p) => SERVICE_WORKER.test(p) && !IGNORED.test(p)) ?? null;
	const swTool = SW_TOOLING.find((t) => t in pkg) ?? null;
	// vite-plugin-pwa and similar generate the manifest too.
	const generatesManifest = !!swTool && swTool !== "@angular/service-worker" && swTool !== "workbox-build" && swTool !== "workbox-webpack-plugin";

	const m = found?.data;
	const name = typeof m?.name === "string" ? m.name : typeof m?.short_name === "string" ? m.short_name : null;
	const display = typeof m?.display === "string" ? m.display : null;
	if (!found && !generatesManifest) issues.push("No web app manifest (manifest.webmanifest or manifest.json with a name and icons).");
	if (found) {
		if (!name) issues.push("The manifest has no name or short_name.");
		if (!m?.start_url) issues.push("The manifest has no start_url.");
		if (!display || !STANDALONE.includes(display)) issues.push('The manifest display should be "standalone" (or fullscreen, minimal-ui).');
		const icons = Array.isArray(m?.icons) ? (m.icons as { sizes?: string }[]) : [];
		const sizes = icons.flatMap((i) => (i.sizes ?? "").split(/\s+/));
		if (!sizes.includes("192x192") || !sizes.includes("512x512")) issues.push("The manifest needs 192×192 and 512×512 icons.");
	}
	if (!swFile && !swTool) issues.push("No service worker (a sw.js / service-worker.js file, or a PWA plugin such as vite-plugin-pwa or @angular/service-worker).");
	return { installable: issues.length === 0, manifest: found?.path ?? null, name, display, serviceWorker: swFile ?? swTool, issues };
}
