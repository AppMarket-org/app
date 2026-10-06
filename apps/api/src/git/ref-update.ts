/**
 * A push that only moves one branch to a commit the repository already has: the commands plus an
 * empty pack, as `git push` sends when no objects are missing. The old SHA makes it a
 * compare-and-swap: Git refuses it ("stale ref") when the branch is no longer there.
 */
const pkt = (line: string) => (line.length + 4).toString(16).padStart(4, "0") + line;

/** "PACK", version 2, zero objects, and the SHA-1 of those 12 bytes. */
const EMPTY_PACK = new Uint8Array([
	0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0,
	...[...("029d08823bd8a8eab510ad6ac75c823cfd3ed31e".match(/../g) ?? [])].map((h) => parseInt(h, 16)),
]);

export function refUpdateBody(ref: string, oldSha: string, newSha: string): Uint8Array {
	const commands = new TextEncoder().encode(`${pkt(`${oldSha} ${newSha} ${ref}\0report-status${newSha === "0".repeat(40) ? " delete-refs" : ""}\n`)}0000`);
	// A deletion sends no pack.
	if (newSha === "0".repeat(40)) return commands;
	const body = new Uint8Array(commands.length + EMPTY_PACK.length);
	body.set(commands);
	body.set(EMPTY_PACK, commands.length);
	return body;
}

/** What the server's report-status says about `ref`: updated, refused because it moved, or anything else. */
export function refUpdateResult(report: string, ref: string): "ok" | "stale" | "error" {
	if (!/unpack ok/.test(report)) return "error";
	if (report.includes(`ok ${ref}\n`)) return "ok";
	const ng = report.match(new RegExp(`ng ${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ([^\\n]*)`));
	return ng && /stale|fetch first|non-fast-forward|failed to lock|cannot lock/.test(ng[1]!) ? "stale" : "error";
}
