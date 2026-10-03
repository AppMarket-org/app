import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";
import { OwnerStore } from "../owners/store.ts";
import { authOptions } from "./options.ts";

export const auth = betterAuth(
	authOptions(env.DB, {
		baseURL: env.PUBLIC_ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
		github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
		turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
		onUserCreated: (user) => new OwnerStore(env.DB).forUser(user),
		onDeviceToken: (token, clientId, scopes) =>
			env.DB.prepare(`UPDATE "session" SET clientId = ?, scopes = ?, deviceName = COALESCE(deviceName, 'Device') WHERE token = ?`).bind(clientId, scopes.join(" "), token).run(),
	}),
);

export type Session = typeof auth.$Infer.Session;
