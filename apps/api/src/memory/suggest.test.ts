import { describe, expect, it } from "vitest";
import { suggestNotes } from "./suggest";

const tool = (args_summary: string, outcome: "ok" | "error" = "ok", name = "Bash") => ({ name, args_summary, outcome });

describe("memory suggestions from a checkpoint (#197)", () => {
	it("finds a gotcha, the commands that worked, and conventions from the prompts", () => {
		const s = suggestNotes(
			{
				prompts: [{ text: "Add a share button. Always keep logic.js free of DOM code. Thanks!" }],
				tools: [tool("npm test", "error"), tool("cd /x && node --test test/*.test.mjs"), tool("git status"), tool("src/game.js", "ok", "Edit")],
			},
			[],
		);
		expect(s).toEqual([
			{ kind: "gotcha", text: "`npm test` fails in this repo; use `node --test test/*.test.mjs`.", tags: ["testing"] },
			{ kind: "convention", text: "Always keep logic.js free of DOM code.", tags: ["convention"] },
		]);
	});

	it("suggests a working build command, and nothing already in memory", () => {
		const record = { prompts: [{ text: "Never deploy by hand." }], tools: [tool("pnpm -s build"), tool("pnpm test")] };
		expect(suggestNotes(record, []).map((s) => s.kind)).toEqual(["command", "command", "convention"]);
		expect(suggestNotes(record, ["Run the tests with `pnpm test`.", "never deploy by hand."]).map((s) => s.text)).toEqual(["Build with `pnpm -s build`."]);
	});

	it("stays quiet for ordinary sessions, and suggests at most three", () => {
		expect(suggestNotes({ prompts: [{ text: "Fix the header color" }], tools: [tool("git diff"), tool("ls")] }, [])).toEqual([]);
		const many = { prompts: [{ text: "Always a. Never b here. Don't c anywhere. Prefer d over e." }], tools: [tool("pnpm test"), tool("pnpm lint")] };
		expect(suggestNotes(many, [])).toHaveLength(3);
	});
});
