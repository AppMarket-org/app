import { env } from "cloudflare:workers";

export interface OutgoingEmail {
	to: { email: string; name?: string };
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
}

/** Errors that stop a whole run (fixing them needs the owner, or time), rather than one message. */
const STOP = new Set(["E_SENDER_NOT_VERIFIED", "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED"]);

export class EmailStopped extends Error {}

/**
 * #230: sends one message through Cloudflare Email Service. "off" while EMAIL_FROM is empty (the
 * sending domain is not onboarded yet). Throws EmailStopped when no more mail can go out this run.
 */
export async function sendEmail(message: OutgoingEmail): Promise<"sent" | "off"> {
	if (!env.EMAIL_FROM) return "off";
	try {
		await env.EMAIL.send({ from: { email: env.EMAIL_FROM, name: "appmarket.org" }, to: message.to.name ? { email: message.to.email, name: message.to.name } : message.to.email, subject: message.subject, text: message.text, html: message.html, headers: message.headers });
		return "sent";
	} catch (error) {
		const code = (error as { code?: string }).code ?? "";
		if (STOP.has(code)) throw new EmailStopped(code);
		throw error;
	}
}
