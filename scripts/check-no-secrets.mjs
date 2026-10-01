// PRD Security: no Artifacts or Cloudflare token in tracked files, Git config or remote URLs.
import { execSync } from "node:child_process";

const patterns = [/art_v1_[0-9a-f]{40}/, /https:\/\/[^\s/@]+:[^\s/@]+@[^\s]*artifacts\.cloudflare\.net/];
const sources = {
	"tracked files": execSync("git grep -I -n -e art_v1_ -e artifacts.cloudflare.net || true", { encoding: "utf8" }),
	"git config": execSync("git config --list --show-origin", { encoding: "utf8" }),
	"git remotes": execSync("git remote -v", { encoding: "utf8" }),
};

let failed = false;
for (const [where, text] of Object.entries(sources)) {
	for (const line of text.split("\n")) {
		if (patterns.some((p) => p.test(line))) {
			failed = true;
			console.error(`Possible credential in ${where}: ${line.replace(/art_v1_[0-9a-f]+/g, "art_v1_****")}`);
		}
	}
}
process.exit(failed ? 1 : 0);
