// Applies D1 migrations: to the local state `cf dev` uses, or with `--remote <database-id>` to a
// deployed database (CI deploys, R22). Workaround: `cf d1 migrations apply --local` (cf 1.0.0-beta.10) prints its result but does not exit,
// so this wrapper stops it once the JSON result list has been printed. Remove when fixed upstream.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const remote = process.argv[2] === "--remote" ? process.argv[3] : undefined;
if (process.argv[2] === "--remote" && !remote) {
	console.error("Usage: node scripts/migrate.mjs [--remote <database-id>]");
	process.exit(2);
}
const args = remote
	? ["d1", "migrations", "apply", remote]
	: ["d1", "migrations", "apply", JSON.parse(readFileSync(new URL("./local-d1.json", import.meta.url), "utf8")).databaseId, "--local", "--persist-to", ".cloudflare/state"];
const child = spawn("cf", args, {
	stdio: ["ignore", "pipe", "inherit"],
});

let output = "";
child.stdout.on("data", (chunk) => {
	process.stdout.write(chunk);
	output += chunk;
	if (/^\s*(\[\]|\])\s*$/m.test(output)) {
		setTimeout(() => child.kill("SIGTERM"), 500);
	}
});
child.on("exit", (code, signal) => {
	process.exit(signal === "SIGTERM" && /^\s*(\[\]|\])\s*$/m.test(output) ? 0 : (code ?? 1));
});
