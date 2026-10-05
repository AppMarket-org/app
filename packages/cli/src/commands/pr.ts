import { gitOr } from "../git.ts";
import { conversation, describe, describeConversation, explainError, getPull, listPulls, mergePull, openPull, type PullContext, pullContext, resolvePull } from "./pulls.ts";

/** `appmarket pr create|list|view|merge` (#260). */
export async function pr(sub: string | undefined, args: string[], flags: { title?: string; body?: string; base?: string; state?: string }): Promise<number> {
	let ctx: PullContext;
	try {
		ctx = await pullContext();
	} catch (error) {
		console.error(explainError(error));
		return 1;
	}
	const origin = new URL(ctx.api).origin;
	const number = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
	try {
		switch (sub) {
			case "create": {
				const title = flags.title ?? gitOr(["log", "-1", "--format=%s"], "");
				if (!title) throw new Error("Give a --title.");
				const p = await openPull(ctx, { title, body: flags.body, base: flags.base });
				console.log(describe(p, origin));
				return 0;
			}
			case "list": {
				const state = flags.state === "closed" || flags.state === "merged" || flags.state === "all" ? flags.state : "open";
				const items = await listPulls(ctx, state);
				if (!items.length) console.log(`No ${state === "all" ? "" : `${state} `}pull requests on ${ctx.target}.`);
				for (const p of items) console.log(`#${p.number}\t${p.state}\t${p.source.branch} → ${p.target.branch}\t${p.title}`);
				return 0;
			}
			case "view": {
				const p = await resolvePull(ctx, number);
				console.log(describe(p, origin));
				if (p.body) console.log(`\n${p.body}`);
				console.log(`\n${describeConversation(await conversation(ctx, p.number))}`);
				return 0;
			}
			case "merge": {
				const p = await resolvePull(ctx, number);
				await mergePull(ctx, p.number);
				console.log(`Merging #${p.number}: rebasing, checks, then ${p.target.branch} moves forward. Follow it with \`appmarket pr view ${p.number}\`.`);
				console.log(describe(await getPull(ctx, p.number), origin));
				return 0;
			}
			default:
				console.error("Usage: appmarket pr create [--title t] [--body b] [--base branch] | list [--state open|merged|closed|all] | view [n] | merge [n]");
				return 1;
		}
	} catch (error) {
		console.error(explainError(error));
		return 1;
	}
}
