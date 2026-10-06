import { type Deps, pullContext } from "./pulls.ts";
import { type IssueCommentView, type IssueView, describeIssue, describeIssueComments, explainIssueError, issuePath } from "./issues.ts";

/** #297: MCP tools for issues (the Agents board's tasks are issues; plane_board shows their numbers). */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const num = { type: "number", description: "The issue number (from plane_board or the repo's issues)." };

export const ISSUE_TOOLS = [
	{
		name: "issue_view",
		description: "Read an issue: its description, type (bug, feature, task), priority, who it is assigned to, how its task on the Agents board stands, and its comments, oldest first. Read the issue behind a task before working on it.",
		inputSchema: obj({ number: num }, ["number"]),
	},
	{
		name: "issue_comment",
		description: "Comment on an issue: report progress, ask a question about what is wanted, or explain why it cannot be done. Markdown.",
		inputSchema: obj({ number: num, body: { type: "string", description: "The comment (Markdown)." } }, ["number", "body"]),
	},
] as const;

export const ISSUE_TOOL_NAMES: ReadonlySet<string> = new Set(ISSUE_TOOLS.map((t) => t.name));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export async function callIssueTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), deps?: Deps): Promise<Result> {
	if (typeof args.number !== "number" || !Number.isInteger(args.number) || args.number < 1) return text("number is required.", true);
	try {
		const ctx = await pullContext(cwd, deps);
		const origin = new URL(ctx.api).origin;
		switch (name) {
			case "issue_view": {
				const [i, c] = await Promise.all([ctx.call<IssueView>(issuePath(ctx, args.number)), ctx.call<{ items: IssueCommentView[] }>(`${issuePath(ctx, args.number)}/comments`)]);
				return text(`${describeIssue(i, origin, ctx.target)}\n\n${i.body || "(no description)"}\n\nComments:\n${describeIssueComments(c.items)}`);
			}
			case "issue_comment": {
				if (typeof args.body !== "string" || !args.body.trim()) return text("body is required.", true);
				await ctx.call(`${issuePath(ctx, args.number)}/comments`, { method: "POST", body: { body: args.body } });
				return text(`Commented on #${args.number}.`);
			}
			default:
				return text(`Unknown tool: ${name}`, true);
		}
	} catch (error) {
		return text(explainIssueError(error), true);
	}
}
