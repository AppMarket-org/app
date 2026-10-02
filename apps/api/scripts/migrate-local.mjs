// Applies D1 migrations to the local state `cf dev` uses.
// Workaround: `cf d1 migrations apply --local` (cf 1.0.0-beta.10) prints its result but does not exit,
// so this wrapper stops it once the JSON result list has been printed. Remove when fixed upstream.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const { databaseId } = JSON.parse(readFileSync(new URL("./local-d1.json", import.meta.url), "utf8"));
const child = spawn("cf", ["d1", "migrations", "apply", databaseId, "--local", "--persist-to", ".cloudflare/state"], {
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
