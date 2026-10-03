import { call } from "../api.ts";
import { deleteCredentials, loadCredentials } from "../credentials.ts";

/** C2 (#106): sign the device out on appmarket.org, then forget it locally. */
export async function logout(api: string): Promise<number> {
	const creds = await loadCredentials(api);
	if (!creds) {
		console.log("Not signed in.");
		return 0;
	}
	await call(api, "/api/auth/sign-out", { method: "POST", token: creds.token, body: {} }).catch(() => undefined);
	await deleteCredentials(api);
	console.log(`Signed out ${creds.handle} on ${creds.device}.`);
	return 0;
}

/** C3 (#106): account, device, scopes and expiry. */
export async function whoami(api: string): Promise<number> {
	const creds = await loadCredentials(api);
	if (!creds) {
		console.log("Not signed in. Run `appmarket login`.");
		return 1;
	}
	const session = await call<{ session: { expiresAt: string; deviceName?: string; scopes?: string } } | null>(api, "/api/auth/get-session", { token: creds.token });
	if (!session) {
		console.log("Your device token is no longer valid (signed out or revoked). Run `appmarket login`.");
		return 1;
	}
	console.log(`Account: ${creds.handle}\nDevice:  ${session.session.deviceName ?? creds.device}\nScopes:  ${session.session.scopes ?? "(full)"}\nExpires: ${new Date(session.session.expiresAt).toISOString()}\nServer:  ${api}`);
	return 0;
}
