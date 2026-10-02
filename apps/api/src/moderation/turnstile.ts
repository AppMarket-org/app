/** Verifies a Cloudflare Turnstile token server-side (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
export async function verifyTurnstile(secret: string, token: string | undefined, ip: string | undefined): Promise<boolean> {
	if (!token) return false;
	const form = new FormData();
	form.append("secret", secret);
	form.append("response", token);
	if (ip) form.append("remoteip", ip);
	const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
	if (!response.ok) return false;
	return ((await response.json()) as { success?: boolean }).success === true;
}
