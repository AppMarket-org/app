// PRD Security: no Artifacts or Cloudflare token in tracked files, Git config or remote URLs.
import { execSync } from "node:child_process";

// Any Artifacts token version (art_v1_..., art_v2_..., ...).
const TOKEN = /art_v\d+_[A-Za-z0-9]{16,}/;
const patterns = [TOKEN, /https:\/\/[^\s/@]+:[^\s/@]+@[^\s]*artifacts\.cloudflare\.net/];
const sources = {
	"tracked files": execSync("git grep -I -n -E -e 'art_v[0-9]+_' -e artifacts.cloudflare.net || true", { encoding: "utf8" }),
	"git config": execSync("git config --list --show-origin", { encoding: "utf8" }),
	"git remotes": execSync("git remote -v", { encoding: "utf8" }),
};

let failed = false;
for (const [where, text] of Object.entries(sources)) {
	for (const line of text.split("\n")) {
		if (patterns.some((p) => p.test(line))) {
			failed = true;
			console.error(`Possible credential in ${where}: ${line.replace(/(art_v\d+_)[A-Za-z0-9]+/g, "$1****")}`);
		}
	}
}
process.exit(failed ? 1 : 0);
