import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirs, HOME } from "./config.ts";

/** C1: the token lives in the OS keychain; a 0600 file is the fallback (with a warning). */
export interface Credentials {
	api: string;
	token: string;
	handle: string;
	device: string;
}

const FILE = join(HOME, "credentials.json");
const SERVICE = "appmarket.org";

type Entry = { getPassword(): string | null; setPassword(v: string): void; deletePassword(): boolean };

async function keychain(api: string): Promise<Entry | null> {
	if (process.env.APPMARKET_NO_KEYCHAIN) return null;
	try {
		const { Entry } = await import("@napi-rs/keyring");
		return new Entry(SERVICE, api) as Entry;
	} catch {
		return null;
	}
}

function readFile(): Record<string, Credentials> {
	try {
		return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Credentials>;
	} catch {
		return {};
	}
}

/** Saves credentials; returns where they went. */
export async function saveCredentials(creds: Credentials, opts: { noKeychain?: boolean } = {}): Promise<"keychain" | "file"> {
	ensureDirs();
	const entry = opts.noKeychain ? null : await keychain(creds.api);
	if (entry) {
		try {
			entry.setPassword(JSON.stringify(creds));
			const rest = readFile();
			if (rest[creds.api]) {
				delete rest[creds.api];
				writeFileSync(FILE, JSON.stringify(rest, null, 2), { mode: 0o600 });
			}
			return "keychain";
		} catch {
			// Fall through to the file.
		}
	}
	const all = readFile();
	all[creds.api] = creds;
	writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
	chmodSync(FILE, 0o600);
	return "file";
}

export async function loadCredentials(api: string): Promise<Credentials | null> {
	// #134: in CI, a token from the environment is used as is and never written anywhere.
	if (process.env.APPMARKET_TOKEN) return { api, token: process.env.APPMARKET_TOKEN, handle: "(APPMARKET_TOKEN)", device: "CI" };
	const entry = await keychain(api);
	if (entry) {
		try {
			const value = entry.getPassword();
			if (value) return JSON.parse(value) as Credentials;
		} catch {
			// Fall through to the file.
		}
	}
	return readFile()[api] ?? null;
}

export async function deleteCredentials(api: string): Promise<void> {
	const entry = await keychain(api);
	try {
		entry?.deletePassword();
	} catch {
		// Already gone.
	}
	const all = readFile();
	if (all[api]) {
		delete all[api];
		if (Object.keys(all).length) writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
		else if (existsSync(FILE)) rmSync(FILE);
	}
}
