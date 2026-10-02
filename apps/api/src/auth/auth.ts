import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";
import { authOptions } from "./options.ts";

export const auth = betterAuth(
	authOptions(env.DB, {
		baseURL: env.PUBLIC_ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
		github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
		turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
	}),
);

export type Session = typeof auth.$Infer.Session;
