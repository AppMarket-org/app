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
		try {
			const token = await call<{ access_token: string }>(api, "/api/auth/device/token", {
				body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: CLIENT_ID },
			});
			const device = (opts.deviceName ?? hostname()).slice(0, 64);
			await call(api, "/api/me/device", { method: "PUT", token: token.access_token, body: { name: device } }).catch(() => undefined);
			const me = await call<{ owner: { handle: string } }>(api, "/api/me/owner", { token: token.access_token });
			const where = await saveCredentials({ api, token: token.access_token, handle: me.owner.handle, device }, { noKeychain: opts.noKeychain });
			if (where === "file") console.warn("Warning: no OS keychain available; the token is in ~/.appmarket/credentials.json (mode 0600).");
			console.log(`Signed in as ${me.owner.handle} on ${device}.`);
			return 0;
		} catch (error) {
			const reason = error instanceof ApiError ? (error.body as { error?: string } | null)?.error : undefined;
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
	}
	console.error("The code expired. Run `appmarket login` again.");
	return 1;
}
