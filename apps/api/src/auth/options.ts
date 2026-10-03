import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, captcha } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { ROLES } from "@appmarket/shared";
import { DEVICE_CLIENT_SCOPES, grantScopes } from "./scopes.ts";

export interface AuthSettings {
	baseURL: string;
	secret: string;
	google: { clientId: string; clientSecret: string };
	github: { clientId: string; clientSecret: string };
	turnstileSecretKey: string;
	/** #102: gives every new user a handle. */
	onUserCreated?: (user: { id: string; email: string }) => Promise<unknown>;
	/** #107: marks a device-login session with its client and granted scopes. */
	onDeviceToken?: (token: string, clientId: string, scopes: string[]) => Promise<unknown>;
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
		session: {
			// #107: set on device-login sessions only; browser sessions keep them null (full access).
			additionalFields: {
				clientId: { type: "string", required: false, input: false },
				scopes: { type: "string", required: false, input: false },
				deviceName: { type: "string", required: false, input: false },
			},
		},
		user: {
			additionalFields: {
				// Everyone starts as a buyer; becoming a developer or admin is a server-side change.
				role: { type: [...ROLES], required: true, defaultValue: "buyer", input: false },
			},
		},
		hooks: {
			// #107: stamp the session a device token was just issued for, before the client can use it.
			after: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/device/token") return;
				const returned = ctx.context.returned as { access_token?: string; scope?: string } | undefined;
				const clientId = (ctx.body as { client_id?: string } | undefined)?.client_id;
				if (!returned?.access_token || !clientId) return;
				const scopes = grantScopes(clientId, returned.scope) ?? [];
				await settings.onDeviceToken?.(returned.access_token, clientId, scopes);
			}),
		},
		databaseHooks: {
			user: { create: { after: async (user: { id: string; email: string }) => void (await settings.onUserCreated?.(user)) } },
		},
		plugins: [
			// #104: CLIs and agents sign in with a code the user approves at /device, then call the API
			// with the session token as a bearer token.
			deviceAuthorization({
				expiresIn: "15m",
				interval: "5s",
				userCodeLength: 8,
				verificationUri: `${settings.baseURL}/device`,
				validateClient: (clientId) => clientId in DEVICE_CLIENT_SCOPES,
				// #107: only the scopes the client may ask for.
				onDeviceAuthRequest: (clientId, scope) => {
					if (!grantScopes(clientId, scope)) throw new APIError("BAD_REQUEST", { error: "invalid_scope", error_description: "Scope not allowed for this client" });
				},
			}),
			bearer(),
			captcha({
				provider: "cloudflare-turnstile",
				secretKey: settings.turnstileSecretKey,
				endpoints: ["/sign-in/social"],
			}),
		],
	} satisfies BetterAuthOptions;
}
