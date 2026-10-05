import semver from "semver";
import type { DeployManifest } from "@appmarket/shared";

export interface GraphEdge {
	kind: "dependency" | "dev-dependency" | "binding";
	target: string;
	detail: string | null;
}

/**
 * #67 (G1): the edges of one version, from its package.json and its deploy manifest (Wrangler
 * bindings). Pure; unit-tested.
 */
export function graphEdges(packageJson: string | undefined, manifest: DeployManifest | null): GraphEdge[] {
	const edges: GraphEdge[] = [];
	try {
		const pkg = JSON.parse(packageJson ?? "{}") as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
		for (const [kind, deps] of [["dependency", pkg.dependencies], ["dev-dependency", pkg.devDependencies]] as const) {
			for (const [name, range] of Object.entries(deps ?? {})) {
				if (/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name) && name.length <= 214) edges.push({ kind, target: name.toLowerCase(), detail: typeof range === "string" ? range.slice(0, 100) : null });
			}
		}
	} catch {
		// No usable package.json: bindings only.
	}
	for (const r of manifest?.resources ?? []) edges.push({ kind: "binding", target: r.type, detail: r.binding || null });
	// One edge per (kind, target, detail).
	return [...new Map(edges.map((e) => [`${e.kind}|${e.target}|${e.detail}`, e])).values()];
}

/** Does a declared range allow this version? Unparseable ranges (git URLs, tags) count as a match. */
export function rangeAllows(range: string | null, version: string): boolean {
	if (!range || !semver.validRange(range)) return true;
	return semver.satisfies(version, range, { includePrerelease: true });
}

/** #69: could a declared range resolve to a vulnerable version? Unparseable ranges count. */
export function rangeOverlaps(declared: string | null, affected: string): boolean {
	if (!declared || !semver.validRange(declared) || !semver.validRange(affected)) return true;
	// No includePrerelease: it turns ^4 into >=4.0.0-0, which would "overlap" <4.0.0 through a
	// prerelease a plain range never installs.
	return semver.intersects(declared, affected);
}
