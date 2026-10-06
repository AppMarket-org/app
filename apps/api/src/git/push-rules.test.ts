import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePushCommands, refusals, refusedPush, ZERO } from "./push-rules";

const A = "a".repeat(40);
const B = "b".repeat(40);
const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;

describe("push rules (#308)", () => {
	it("reads the commands and capabilities before the pack", () => {
		const body = new TextEncoder().encode(`${pkt(`${A} ${B} refs/heads/feature\0report-status side-band-64k agent=git/2\n`)}${pkt(`${ZERO} ${B} refs/tags/v1\n`)}0000PACK...`);
		const parsed = parsePushCommands(body)!;
		expect(parsed.commands).toEqual([
			{ old: A, new: B, ref: "refs/heads/feature" },
			{ old: ZERO, new: B, ref: "refs/tags/v1" },
		]);
		expect(parsed.capabilities).toEqual(["report-status", "side-band-64k", "agent=git/2"]);
		expect(new TextDecoder().decode(body.subarray(parsed.end))).toBe("PACK...");
		expect(parsePushCommands(body.subarray(0, 20))).toBeNull();
	});

	it("allows any unprotected branch; refuses protected ones, tags, and deleting others' branches", () => {
		const rules = { protectedBranches: ["main", "release/*"], created: new Set(["agent/mine"]) };
		const cmd = (ref: string, next = B) => ({ old: A, new: next, ref });
		expect(refusals([cmd("refs/heads/feature/x"), cmd("refs/heads/agent/mine", ZERO)], rules)).toEqual([]);
		expect(refusals([cmd("refs/heads/main"), cmd("refs/heads/release/1.2"), cmd("refs/tags/v2"), cmd("refs/heads/someone-else", ZERO)], rules).map((r) => r.ref)).toEqual([
			"refs/heads/main",
			"refs/heads/release/1.2",
			"refs/tags/v2",
			"refs/heads/someone-else",
		]);
	});

	it("is understood by git: the push fails as remote rejected, with the reason", async () => {
		const root = mkdtempSync(join(tmpdir(), "am-rules-"));
		const bare = join(root, "repo.git");
		execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
		const work = join(root, "work");
		execFileSync("git", ["init", "-q", "-b", "main", work]);
		writeFileSync(join(work, "a.txt"), "a\n");
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@x.test", "commit", "-qam", "x", "--allow-empty"], { cwd: work });
		execFileSync("git", ["add", "a.txt"], { cwd: work });
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@x.test", "commit", "-qm", "a"], { cwd: work });
		const server = createServer((req, res) => {
			if (req.method === "GET") {
				const adv = execFileSync("git", ["receive-pack", "--stateless-rpc", "--advertise-refs", bare]);
				res.writeHead(200, { "Content-Type": "application/x-git-receive-pack-advertisement" });
				res.end(Buffer.concat([Buffer.from(`${pkt("# service=git-receive-pack\n")}0000`), adv]));
				return;
			}
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => {
				const parsed = parsePushCommands(new Uint8Array(Buffer.concat(chunks)))!;
				const out = refusedPush(parsed, refusals(parsed.commands, { protectedBranches: ["main"], created: new Set() }));
				res.writeHead(200, { "Content-Type": "application/x-git-receive-pack-result" });
				res.end(Buffer.from(out));
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const { port } = server.address() as AddressInfo;
		const push = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
			const child = spawn("git", ["push", `http://127.0.0.1:${port}/repo.git`, "main"], { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
			let stderr = "";
			child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
			child.on("close", (status) => resolve({ status, stderr }));
		});
		server.close();
		expect(push.status).not.toBe(0);
		expect(push.stderr).toContain("[remote rejected] main -> main (protected branch; push your own branch and open a pull request)");
		expect(push.stderr).toContain("remote: appmarket.org: this push was refused for an agent session.");
		expect(execFileSync("git", ["--git-dir", bare, "for-each-ref"], { encoding: "utf8" })).toBe("");
	}, 20_000);
});
