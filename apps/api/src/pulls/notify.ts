import { env } from "cloudflare:workers";
import { EmailStopped, sendEmail } from "../email/send.ts";
import { unsubscribeQuery } from "../email/unsubscribe.ts";
import { logEvent } from "../observability/log.ts";
import { pullEmail } from "./notify-email.ts";

/**
 * Emails the people a pull request event concerns (never the one who acted), if they did not turn
 * pull request emails off. Best effort: failures are logged, never returned to the user.
 */
export async function notifyPull(input: { repo: string; number: number; title: string; actorId: string; actor: string; what: string; excerpt?: string; userIds: string[] }): Promise<void> {
	if (!env.EMAIL_FROM) return;
	const ids = [...new Set(input.userIds)].filter((id) => id !== input.actorId).slice(0, 50);
	if (!ids.length) return;
	const { results } = await env.DB.prepare(
		`SELECT u.id, u.email, u.name, p.pulls FROM "user" u LEFT JOIN email_preferences p ON p.user_id = u.id WHERE u.id IN (${ids.map(() => "?").join(",")})`,
	)
		.bind(...ids)
		.all<{ id: string; email: string; name: string; pulls: number | null }>();
	const url = `${env.PUBLIC_ORIGIN}/${input.repo}/pulls/${input.number}`;
	for (const person of results) {
		if (!person.email || person.pulls === 0) continue;
		const query = await unsubscribeQuery(env.BETTER_AUTH_SECRET, person.id, "pulls");
		const oneClick = `${env.PUBLIC_ORIGIN}/api/email/unsubscribe?${query}`;
		const message = pullEmail({ ...input, excerpt: (input.excerpt ?? "").slice(0, 600), url, unsubscribe: `${env.PUBLIC_ORIGIN}/email/unsubscribe?${query}` });
		try {
			await sendEmail({
				to: { email: person.email, name: person.name },
				...message,
				headers: { ...(oneClick.startsWith("https://") ? { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}), "Auto-Submitted": "auto-generated" },
			});
		} catch (error) {
			logEvent(error instanceof EmailStopped ? "email.stopped" : "email.failed", { topic: "pulls", error: error instanceof Error ? error.message : String(error) }, "warn");
			if (error instanceof EmailStopped) return;
		}
	}
}

/** Who hears about a new pull request: the user who owns the repo, or the organization's owners. */
export async function repoOwners(ownerId: string): Promise<string[]> {
	const owner = await env.DB.prepare("SELECT kind, user_id FROM owners WHERE id = ?").bind(ownerId).first<{ kind: string; user_id: string | null }>();
	if (owner?.kind === "user") return owner.user_id ? [owner.user_id] : [];
	const { results } = await env.DB.prepare("SELECT user_id FROM org_members WHERE org_id = ? AND role = 'owner'").bind(ownerId).all<{ user_id: string }>();
	return results.map((r) => r.user_id);
}

/** Everyone in a pull request's conversation: its author, commenters and reviewers. */
export async function participants(pullId: string, authorId: string): Promise<string[]> {
	const { results } = await env.DB.prepare(
		"SELECT author_id AS id FROM pull_comments WHERE pull_id = ? AND deleted_at IS NULL UNION SELECT reviewer_id FROM pull_reviews WHERE pull_id = ?",
	)
		.bind(pullId, pullId)
		.all<{ id: string }>();
	return [authorId, ...results.map((r) => r.id)];
}
