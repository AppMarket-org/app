/** #230: the email an owner gets when an impact (#69) newly affects their repos. Pure, for tests. */
export interface ImpactItem {
	impactId: string;
	title: string;
	guidance: string;
	repo: string;
	detail: string | null;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function impactEmail(items: ImpactItem[], origin: string, unsubscribeUrl: string): { subject: string; text: string; html: string } {
	const byImpact = new Map<string, { title: string; guidance: string; repos: { repo: string; detail: string | null }[] }>();
	for (const i of items) {
		const entry = byImpact.get(i.impactId) ?? { title: i.title, guidance: i.guidance, repos: [] };
		entry.repos.push({ repo: i.repo, detail: i.detail });
		byImpact.set(i.impactId, entry);
	}
	const impacts = [...byImpact.values()];
	const repos = new Set(items.map((i) => i.repo));
	const subject =
		impacts.length === 1 ? `${impacts[0]!.title}: ${repos.size === 1 ? [...repos][0] : `${repos.size} of your repos`} affected` : `${impacts.length} notices affect your repos on appmarket.org`;
	const dashboard = `${origin}/dashboard`;

	const text = [
		impacts.length === 1 ? "A notice on appmarket.org affects your repos." : "Notices on appmarket.org affect your repos.",
		"",
		...impacts.flatMap((i) => [
			i.title,
			...i.repos.map((r) => `  - ${r.repo}${r.detail ? ` (${r.detail})` : ""}: ${origin}/${r.repo}`),
			"",
			`What to do: ${i.guidance}`,
			"",
		]),
		`See all notices on your dashboard: ${dashboard}`,
		"",
		`You get these emails because you own the repos above. Stop them: ${unsubscribeUrl}`,
	].join("\n");

	const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1b1c18;max-width:40rem;margin:0 auto;padding:1.5rem">
<p>${impacts.length === 1 ? "A notice on appmarket.org affects your repos." : "Notices on appmarket.org affect your repos."}</p>
${impacts
	.map(
		(i) => `<h2 style="font-size:1.125rem;margin:1.5rem 0 0.5rem">${escape(i.title)}</h2>
<ul>${i.repos.map((r) => `<li><a href="${escape(`${origin}/${r.repo}`)}">${escape(r.repo)}</a>${r.detail ? ` <span style="color:#5c5f57">(${escape(r.detail)})</span>` : ""}</li>`).join("")}</ul>
<p><strong>What to do:</strong> ${escape(i.guidance)}</p>`,
	)
	.join("\n")}
<p><a href="${escape(dashboard)}">See all notices on your dashboard</a></p>
<p style="color:#5c5f57;font-size:0.8125rem">You get these emails because you own the repos above. <a href="${escape(unsubscribeUrl)}">Stop these emails</a>.</p>
</body></html>`;
	return { subject, text, html };
}
