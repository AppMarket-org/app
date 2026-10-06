const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type ThreadEmail = { repo: string; number: number; title: string; actor: string; what: string; excerpt: string; url: string; unsubscribe: string };

/** #298: the email for one issue event. */
export const issueEmail = (e: ThreadEmail) => pullEmail(e, "issue");

/** #258: the email for one pull request (or issue) event. Pure, for tests. */
export function pullEmail(e: ThreadEmail, kind: "pull request" | "issue" = "pull request"): { subject: string; text: string; html: string } {
	const subject = `[${e.repo}] #${e.number} ${e.title}`;
	const text = [`${e.actor} ${e.what}.`, "", ...(e.excerpt ? [e.excerpt, ""] : []), `View it: ${e.url}`, "", `Stop ${kind} emails: ${e.unsubscribe}`].join("\n");
	const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1b1c18;max-width:40rem;margin:0 auto;padding:1.5rem">
<p><strong>${escape(e.actor)}</strong> ${escape(e.what)}.</p>
${e.excerpt ? `<blockquote style="margin:0;padding:0.5rem 1rem;border-left:0.25rem solid #d8dbd0;color:#44483e;white-space:pre-wrap">${escape(e.excerpt)}</blockquote>` : ""}
<p><a href="${escape(e.url)}">View ${kind} #${e.number}</a></p>
<p style="color:#5c5f57;font-size:0.8125rem"><a href="${escape(e.unsubscribe)}">Stop ${kind} emails</a></p>
</body></html>`;
	return { subject, text, html };
}
