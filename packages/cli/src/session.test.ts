import { describe, expect, it } from "vitest";
import { credentialUrl, sessionFor, type StoredSession } from "./commands/session.ts";

const s = (id: string, remote: string): StoredSession => ({ id, api: "https://appmarket.org", repo: "a/b", fork: "a/b-session", remote, token: "t", expiresAt: "2099-01-01T00:00:00Z" });

describe("agent session credential helper (#29)", () => {
	it("reads the URL Git asks for", () => {
		expect(credentialUrl("protocol=https\nhost=example.artifacts.dev\npath=ns/repo-1.git\n")).toBe("https://example.artifacts.dev/ns/repo-1.git");
		expect(credentialUrl("host=x\n")).toBeNull();
	});

	it("answers only for a stored session's own remote", () => {
		const sessions = [s("1", "https://example.artifacts.dev/ns/fork-1.git"), s("2", "https://example.artifacts.dev/ns/fork-2.git")];
		expect(sessionFor("https://example.artifacts.dev/ns/fork-2.git", sessions)?.id).toBe("2");
		expect(sessionFor("https://example.artifacts.dev/ns/fork-2", sessions)?.id).toBe("2");
		expect(sessionFor("https://example.artifacts.dev/ns/source.git", sessions)).toBeNull();
		expect(sessionFor("https://evil.example/ns/fork-1.git", sessions)).toBeNull();
	});
});
