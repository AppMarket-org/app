import { conversation, type Deps, describe, describeConversation, explainError, openPull, pullContext, reply, resolvePull } from "./pulls.ts";

/** #260: MCP tools for pull requests; the same in every harness. */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const num = { type: "number", description: "The pull request number; omit for the open one of the current branch." };

export const PR_TOOLS = [
	{
		name: "pr_open",
		description:
			"Open a pull request for the current branch (push it first). From an agent session or a fork it goes to the original repo; otherwise to this repo's default branch. Returns the existing one if the branch already has one open.",
		inputSchema: obj({ title: { type: "string", description: "What the change does." }, body: { type: "string", description: "Why, and how to test it (Markdown)." }, base: { type: "string", description: "Target branch (default: the repo's default branch)." } }, ["title"]),
	},
	{
		name: "pr_status",
		description: "A pull request's state: open/merged/closed, review decision, whether it can be merged and why not, and the latest merge attempt (checks, conflicts).",
		inputSchema: obj({ number: num }),
	},
	{
		name: "pr_comments",
		description: "A pull request's conversation: comments (with file and line for line comments) and reviews, oldest first. Read it to see what reviewers asked for.",
		inputSchema: obj({ number: num }),
	},
	{
		name: "pr_reply",
		description: "Comment on a pull request, or on a line of its diff (path, line and side: new for added or kept lines, old for removed ones).",
		inputSchema: obj(
			{ number: num, body: { type: "string", description: "The comment (Markdown)." }, path: { type: "string" }, line: { type: "number" }, side: { type: "string", enum: ["old", "new"] } },
			["body"],
		),
	},
] as const;

export const PR_TOOL_NAMES: ReadonlySet<string> = new Set(PR_TOOLS.map((t) => t.name));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export async function callPrTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), deps?: Deps): Promise<Result> {
	try {
		const ctx = await pullContext(cwd, deps);
		const origin = new URL(ctx.api).origin;
		const n = typeof args.number === "number" ? args.number : undefined;
		switch (name) {
			case "pr_open": {
				if (typeof args.title !== "string" || !args.title.trim()) return text("title is required.", true);
				const p = await openPull(ctx, { title: args.title, body: typeof args.body === "string" ? args.body : undefined, base: typeof args.base === "string" ? args.base : undefined });
				return text(describe(p, origin));
			}
			case "pr_status":
				return text(describe(await resolvePull(ctx, n), origin));
			case "pr_comments": {
				const p = await resolvePull(ctx, n);
				return text(`#${p.number} ${p.title}\n\n${describeConversation(await conversation(ctx, p.number))}`);
			}
			case "pr_reply": {
				if (typeof args.body !== "string" || !args.body.trim()) return text("body is required.", true);
				const p = await resolvePull(ctx, n);
				const line = typeof args.path === "string" ? { path: args.path, line: Number(args.line), side: args.side === "old" ? ("old" as const) : ("new" as const) } : {};
				await reply(ctx, p.number, { body: args.body, ...line });
				return text(`Commented on #${p.number}${"path" in line ? ` at ${line.path}:${line.line}` : ""}.`);
			}
			default:
				return text(`Unknown tool: ${name}`, true);
		}
	} catch (error) {
		return text(explainError(error), true);
	}
}
