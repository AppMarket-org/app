import { describe, expect, it } from "vitest";
import { open, seal } from "./transcript-crypto.ts";

const master = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7)));
const other = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 255 - i)));
const text = (s: string) => new TextEncoder().encode(s);

describe("transcript encryption (#129)", () => {
	it("round-trips for the right account and refuses anything else", async () => {
		const sealed = await seal(master, "owner-1", "repo:sha", text(JSON.stringify({ prompts: [] })));
		expect(new TextDecoder().decode(sealed)).not.toContain("prompts");
		expect(new TextDecoder().decode(await open(master, "owner-1", "repo:sha", sealed))).toBe('{"prompts":[]}');
		await expect(open(master, "owner-2", "repo:sha", sealed)).rejects.toThrow(); // another account's key
		await expect(open(other, "owner-1", "repo:sha", sealed)).rejects.toThrow(); // without the secret
		await expect(open(master, "owner-1", "repo:other", sealed)).rejects.toThrow(); // moved to another checkpoint
		const again = await seal(master, "owner-1", "repo:sha", text(JSON.stringify({ prompts: [] })));
		expect(again).not.toEqual(sealed); // random IV
	});
});
