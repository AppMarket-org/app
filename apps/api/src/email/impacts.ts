import { env } from "cloudflare:workers";
import { logEvent } from "../observability/log.ts";
import { impactEmail, type ImpactItem } from "./impact-email.ts";
import { EmailStopped, sendEmail } from "./send.ts";
import { unsubscribeQuery } from "./unsubscribe.ts";

/** Only repos found affected recently are emailed; older ones are marked without a message. */
const FRESH_MS = 7 * 24 * 3600 * 1000;
const MAX_PEOPLE = 20;

interface Row {
	impact_id: string;
	repo_id: string;
	detail: string | null;
	found_at: string;
	title: string;
	guidance: string;
	repo: string;
	kind: "user" | "org";
	owner_id: string;
	owner_user: string | null;
}

/**
 * #230 (cron): emails owners about impacts (#69) that newly affect their repos: one message per
 * person per run, to the user who owns the repo or the owners of the organization. Each affected
 * repo is emailed once; people who turned these emails off are skipped.
 */
export async function emailImpacts(): Promise<void> {
	if (!env.EMAIL_FROM) return;
	const { results } = await env.DB.prepare(
		`SELECT x.impact_id, x.repo_id, x.detail, x.found_at, i.title, i.guidance, o.handle || '/' || r.slug AS repo, o.kind, o.id AS owner_id, o.user_id AS owner_user
		 FROM impact_repos x JOIN impacts i ON i.id = x.impact_id JOIN repos r ON r.id = x.repo_id JOIN owners o ON o.id = r.owner_id
		 WHERE x.emailed_at IS NULL AND x.resolved_at IS NULL AND i.closed_at IS NULL AND r.state != 'removed' AND r.session_of IS NULL
		 ORDER BY x.found_at LIMIT 200`,
	).all<Row>();
	if (!results.length) return;
	const mark = (rows: Row[]) =>
		rows.length
			? env.DB.batch(rows.map((r) => env.DB.prepare("UPDATE impact_repos SET emailed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE impact_id = ? AND repo_id = ?").bind(r.impact_id, r.repo_id)))
			: Promise.resolve([]);

	const stale = results.filter((r) => Date.now() - Date.parse(r.found_at) > FRESH_MS);
	await mark(stale);
	const fresh = results.filter((r) => !stale.includes(r));

	// Who hears about each row: the owning user, or the organization's owners.
	const orgIds = [...new Set(fresh.filter((r) => r.kind === "org").map((r) => r.owner_id))];
	const orgOwners = new Map<string, string[]>();
	for (const id of orgIds) {
		const { results: members } = await env.DB.prepare("SELECT user_id FROM org_members WHERE org_id = ? AND role = 'owner'").bind(id).all<{ user_id: string }>();
		orgOwners.set(id, members.map((m) => m.user_id));
	}
	const recipients = (r: Row) => (r.kind === "user" ? (r.owner_user ? [r.owner_user] : []) : (orgOwners.get(r.owner_id) ?? []));
	const perUser = new Map<string, Row[]>();
	for (const r of fresh) for (const u of recipients(r)) perUser.set(u, [...(perUser.get(u) ?? []), r]);

	const handled = new Map<Row, number>();
	const done = (rows: Row[]) => rows.forEach((r) => handled.set(r, (handled.get(r) ?? 0) + 1));
	const users = [...perUser.keys()].slice(0, MAX_PEOPLE);
	const people = new Map<string, { email: string; name: string; impacts: number | null }>();
	for (let i = 0; i < users.length; i += 50) {
		const batch = users.slice(i, i + 50);
		const { results: found } = await env.DB.prepare(
			`SELECT u.id, u.email, u.name, p.impacts FROM "user" u LEFT JOIN email_preferences p ON p.user_id = u.id WHERE u.id IN (${batch.map(() => "?").join(",")})`,
		)
			.bind(...batch)
			.all<{ id: string; email: string; name: string; impacts: number | null }>();
		for (const p of found) people.set(p.id, p);
	}

	let sent = 0;
	try {
		for (const userId of users) {
			const rows = perUser.get(userId)!;
			const person = people.get(userId);
			if (!person?.email || person.impacts === 0) {
				done(rows);
				continue;
			}
			const unsubscribe = `${env.PUBLIC_ORIGIN}/api/email/unsubscribe?${await unsubscribeQuery(env.BETTER_AUTH_SECRET, userId, "impacts")}`;
			const page = `${env.PUBLIC_ORIGIN}/email/unsubscribe?${await unsubscribeQuery(env.BETTER_AUTH_SECRET, userId, "impacts")}`;
			const items: ImpactItem[] = rows.map((r) => ({ impactId: r.impact_id, title: r.title, guidance: r.guidance, repo: r.repo, detail: r.detail }));
			const message = impactEmail(items, env.PUBLIC_ORIGIN, page);
			try {
				await sendEmail({
					to: { email: person.email, name: person.name },
					...message,
					headers: {
						// RFC 8058 one-click unsubscribe (Gmail and Yahoo require it for bulk senders); https only.
						...(unsubscribe.startsWith("https://") ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
						"Auto-Submitted": "auto-generated",
					},
				});
				sent++;
				done(rows);
			} catch (error) {
				if (error instanceof EmailStopped) throw error;
				logEvent("email.failed", { topic: "impacts", user: userId, error: error instanceof Error ? error.message : String(error) }, "warn");
			}
		}
	} catch (error) {
		logEvent("email.stopped", { topic: "impacts", reason: error instanceof Error ? error.message : String(error) }, "error");
	}
	// A row is done once every person it concerns got (or opted out of) the message.
	const complete = fresh.filter((r) => recipients(r).length === 0 || (recipients(r).every((u) => users.includes(u)) && handled.get(r) === recipients(r).length));
	await mark(complete);
	if (sent) logEvent("email.sent", { topic: "impacts", count: sent });
}
