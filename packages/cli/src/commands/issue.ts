import type { PullContext } from "./pulls.ts";
import { pullContext } from "./pulls.ts";
import { type IssueCommentView, type IssueView, describeIssue, describeIssueComments, explainIssueError, issuePath } from "./issues.ts";

export interface IssueFlags {
	title?: string;
	body?: string;
	type?: string;
	priority?: string;
	assign?: string;
	state?: string;
	notPlanned?: boolean;
}

const USAGE =
	"Usage: appmarket issue create --title t [--body b] [--type bug|feature|task] [--priority low|medium|high|urgent] [--assign agents|<handle>]\n" +
	"       appmarket issue list [--state open|closed|all] [--type t] [--assign agents|<handle>] | view <n> | comment <n> --body b | close <n> [--not-planned] | reopen <n>";

/** `appmarket issue …` (#297). */
export async function issue(sub: string | undefined, args: string[], flags: IssueFlags, getContext: () => Promise<PullContext> = () => pullContext()): Promise<number> {
	const number = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
	if (!sub || !["create", "list", "view", "comment", "close", "reopen"].includes(sub) || (["view", "comment", "close", "reopen"].includes(sub) && number === undefined)) {
		console.error(USAGE);
		return 1;
	}
	try {
		const ctx = await getContext();
		const origin = new URL(ctx.api).origin;
		const show = (i: IssueView) => console.log(describeIssue(i, origin, ctx.target));
		switch (sub) {
			case "create": {
				if (!flags.title) throw new Error("Give a --title.");
				const assignee = flags.assign === undefined || flags.assign === "none" ? undefined : flags.assign;
				show(await ctx.call<IssueView>(issuePath(ctx), { method: "POST", body: { title: flags.title, body: flags.body, type: flags.type, priority: flags.priority, assignee } }));
				return 0;
			}
			case "list": {
				const query = new URLSearchParams();
				if (flags.state) query.set("state", flags.state);
				if (flags.type) query.set("type", flags.type);
				if (flags.assign) query.set("assignee", flags.assign);
				const { items } = await ctx.call<{ items: IssueView[] }>(`${issuePath(ctx)}${query.size ? `?${query}` : ""}`);
				if (!items.length) console.log(`No ${flags.state === "all" ? "" : `${flags.state ?? "open"} `}issues on ${ctx.target}.`);
				for (const i of items) console.log(`#${i.number}\t${i.state}\t${i.type}\t${i.priority}\t${i.assignee?.kind === "agents" ? "agents" : i.assignee?.handle ?? "-"}\t${i.title}`);
				return 0;
			}
			case "view": {
				const i = await ctx.call<IssueView>(issuePath(ctx, number));
				show(i);
				if (i.body) console.log(`\n${i.body}`);
				const { items } = await ctx.call<{ items: IssueCommentView[] }>(`${issuePath(ctx, number)}/comments`);
				console.log(`\n${describeIssueComments(items)}`);
				return 0;
			}
			case "comment": {
				if (!flags.body) throw new Error("Give a --body.");
				await ctx.call(`${issuePath(ctx, number)}/comments`, { method: "POST", body: { body: flags.body } });
				console.log(`Commented on #${number}.`);
				return 0;
			}
			case "close":
			case "reopen": {
				const body = sub === "close" ? { state: "closed", reason: flags.notPlanned ? "not_planned" : "completed" } : { state: "open" };
				show(await ctx.call<IssueView>(issuePath(ctx, number), { method: "PATCH", body }));
				return 0;
			}
		}
		return 1;
	} catch (error) {
		console.error(error instanceof Error && !("status" in error) && error.message.startsWith("Give") ? error.message : explainIssueError(error));
		return 1;
	}
}
