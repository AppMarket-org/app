import type { BetterAuthOptions } from "better-auth";
import { captcha } from "better-auth/plugins";
import { ROLES } from "@appmarket/shared";

export interface AuthSettings {
	baseURL: string;
	secret: string;
	google: { clientId: string; clientSecret: string };
	github: { clientId: string; clientSecret: string };
	turnstileSecretKey: string;
}

// PRD R11: Google and GitHub login, sessions in D1, a role on every user.
// Kept free of Worker imports so scripts/generate-auth-schema.ts can build the same schema offline.
export function authOptions(database: BetterAuthOptions["database"], settings: AuthSettings) {
	return {
		database,
		baseURL: settings.baseURL,
		basePath: "/api/auth",
		secret: settings.secret,
		trustedOrigins: [settings.baseURL],
		socialProviders: {
			google: { ...settings.google, prompt: "select_account" },
			github: settings.github,
		},
		account: {
			// Same verified email from Google and GitHub signs in to one user.
			accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
		},
		user: {
			additionalFields: {
				// Everyone starts as a buyer; becoming a developer or admin is a server-side change.
				role: { type: [...ROLES], required: true, defaultValue: "buyer", input: false },
			},
		},
		plugins: [
			captcha({
				provider: "cloudflare-turnstile",
				secretKey: settings.turnstileSecretKey,
				endpoints: ["/sign-in/social"],
			}),
		],
	} satisfies BetterAuthOptions;
}
