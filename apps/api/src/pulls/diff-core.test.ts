import { describe, expect, it } from "vitest";
import { commitsSince, diffTrees, fileHunks, isBinary, mergeBase, type TreeEntry } from "./diff-core";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe("pull request diff (#257)", () => {
	it("finds the merge base, through merge commits too", () => {
		// main: A - B - D ; branch from B: C - E (E merges D back in)
		const base = [c("D", "B"), c("B", "A"), c("A")];
		expect(mergeBase(base, [c("C", "B"), c("B", "A"), c("A")])).toBe("B");
		expect(mergeBase(base, [c("E", "C", "D"), c("C", "B"), c("D", "B"), c("B", "A"), c("A")])).toBe("D");
		expect(mergeBase(base, [c("X")])).toBeNull();
		expect(commitsSince([c("E", "C", "D"), c("C", "B"), c("D", "B"), c("B", "A"), c("A")], "D", new Set(["D", "B", "A"]))).toEqual(["C", "E"]);
	});

	it("lists added, modified and deleted files, skipping unchanged subtrees", async () => {
		const trees: Record<string, TreeEntry[]> = {
			old: [
				{ name: "README.md", type: "blob", hash: "r1" },
				{ name: "src", type: "tree", hash: "s1" },
				{ name: "docs", type: "tree", hash: "d1" },
				{ name: "gone.txt", type: "blob", hash: "g1" },
			],
			s1: [{ name: "a.ts", type: "blob", hash: "a1" }],
			new: [
				{ name: "README.md", type: "blob", hash: "r1" },
				{ name: "src", type: "tree", hash: "s2" },
				{ name: "docs", type: "tree", hash: "d1" },
				{ name: "node_modules", type: "tree", hash: "nm" },
			],
			s2: [
				{ name: "a.ts", type: "blob", hash: "a2" },
				{ name: "b.ts", type: "blob", hash: "b1" },
			],
		};
		const read = async (h: string) => trees[h] ?? null;
		const reads: string[] = [];
		const counting = async (h: string) => (reads.push(h), read(h));
		const { files } = await diffTrees(counting, read, "old", "new");
		expect(files).toEqual([
			{ path: "gone.txt", status: "deleted", oldHash: "g1", newHash: null },
			{ path: "src/a.ts", status: "modified", oldHash: "a1", newHash: "a2" },
			{ path: "src/b.ts", status: "added", oldHash: null, newHash: "b1" },
		]);
		expect(reads).not.toContain("d1");
		expect((await diffTrees(read, read, "old", "new", 1)).truncated).toBe(true);
	});

	it("makes hunks with counts, and spots binary files", () => {
		const d = fileHunks("a\nb\nc\n", "a\nB\nc\nd\n");
		expect(d).toMatchObject({ additions: 2, deletions: 1 });
		expect(d.hunks[0]!.lines).toEqual([" a", "-b", "+B", " c", "+d"]);
		expect(isBinary(new Uint8Array([1, 0, 2]))).toBe(true);
		expect(isBinary(new TextEncoder().encode("text"))).toBe(false);
	});
});
