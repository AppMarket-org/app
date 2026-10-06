import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { ApiError, call } from "../api.ts";
import { CLIENT_ID } from "../config.ts";
import { saveCredentials } from "../credentials.ts";

interface CodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
}

function openBrowser(url: string): void {
	const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
	try {
		spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
	} catch {
		// No browser: the URL is printed anyway.
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** #134: sign in with a CI token from Settings (non-interactive). */
export async function loginWithToken(api: string, token: string, opts: { noKeychain?: boolean }): Promise<number> {
	const session = await call<{ session: { deviceName?: string } } | null>(api, "/api/auth/get-session", { token }).catch(() => null);
	if (!session) {
		console.error("That token is not valid (wrong, expired or revoked). Create one in Settings → Signed-in devices.");
		return 1;
	}
	const me = await call<{ owner: { handle: string } }>(api, "/api/me/owner", { token });
	const device = session.session.deviceName ?? "CI";
	const where = await saveCredentials({ api, token, handle: me.owner.handle, device }, { noKeychain: opts.noKeychain });
	console.log(`Signed in as ${me.owner.handle} with the CI token "${device}" (${where === "keychain" ? "OS keychain" : "~/.appmarket/credentials.json"}).`);
	return 0;
}

/** Retries a request through network errors (not API errors), a few times. */
async function retry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (error) {
			if (error instanceof ApiError || i >= attempts) throw error;
			await sleep(1000 * i);
		}
	}
}

/** C1 (#106): OAuth device code login (RFC 8628). */
export async function login(api: string, opts: { noBrowser?: boolean; deviceName?: string; noKeychain?: boolean }): Promise<number> {
	const code = await call<CodeResponse>(api, "/api/auth/device/code", { body: { client_id: CLIENT_ID } });
	const pretty = `${code.user_code.slice(0, 4)}-${code.user_code.slice(4)}`;
	console.log(`\nTo sign in, open ${code.verification_uri}\nand enter the code:  ${pretty}\n`);
	if (!opts.noBrowser) openBrowser(code.verification_uri_complete);

	let interval = code.interval * 1000;
	const deadline = Date.now() + code.expires_in * 1000;
	while (Date.now() < deadline) {
		await sleep(interval);
		let token: { access_token: string };
		try {
			token = await call<{ access_token: string }>(api, "/api/auth/device/token", {
				body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: CLIENT_ID },
			});
		} catch (error) {
			// A network blip while waiting must not lose the sign-in: keep asking until the code expires.
			if (!(error instanceof ApiError)) {
				interval = Math.min(interval + 1000, 15_000);
				continue;
			}
			const reason = (error.body as { error?: string } | null)?.error;
			if (reason === "authorization_pending") continue;
			if (reason === "slow_down") {
				interval += 5000;
				continue;
			}
			if (reason === "access_denied") {
				console.error("Sign-in was denied.");
				return 1;
			}
			if (reason === "expired_token") break;
			throw error;
		}
		// The approved token is only handed out once: keep it before anything else can fail.
		const device = (opts.deviceName ?? hostname()).slice(0, 64);
		const me = await retry(() => call<{ owner: { handle: string } }>(api, "/api/me/owner", { token: token.access_token })).catch(() => null);
		const handle = me?.owner.handle ?? "(unknown)";
		const where = await saveCredentials({ api, token: token.access_token, handle, device }, { noKeychain: opts.noKeychain });
		await retry(() => call(api, "/api/me/device", { method: "PUT", token: token.access_token, body: { name: device } })).catch(() => undefined);
		if (where === "file") console.warn("Warning: no OS keychain available; the token is in ~/.appmarket/credentials.json (mode 0600).");
		console.log(`Signed in as ${handle} on ${device}.`);
		return 0;
	}
	console.error("The code expired. Run `appmarket login` again.");
	return 1;
}
