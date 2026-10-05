// PRD Security: no credentials in tracked files, Git config or remote URLs. Runs before every
// commit; the repo is meant to be public. Patterns require realistic lengths so test fixtures
// such as "whsec_test" or docs placeholders such as "sk_test_…" do not trip it.
import { execSync } from "node:child_process";

const PATTERNS = [
	// Any Artifacts token version (art_v1_..., art_v2_..., ...).
	["Artifacts token", /art_v\d+_[A-Za-z0-9]{16,}/],
	["Artifacts remote with credentials", /https:\/\/[^\s/@]+:[^\s/@]+@[^\s]*artifacts\.cloudflare\.net/],
	// #42: Stripe secret and restricted keys, webhook signing secrets.
	["Stripe key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{20,}/],
	["Webhook signing secret", /\bwhsec_[A-Za-z0-9_-]{24,}/],
	["GitHub token", /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})/],
	["Cloudflare API token", /\bCLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{40}/],
	["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const GREP = "-e 'art_v[0-9]+_' -e artifacts.cloudflare.net -e '_(live|test)_' -e whsec_ -e ghp_ -e github_pat_ -e CLOUDFLARE_API_TOKEN -e 'PRIVATE KEY-----'";

const sources = {
	"tracked files": execSync(`git grep -I -n -E ${GREP} || true`, { encoding: "utf8" }),
	"git config": execSync("git config --list --show-origin", { encoding: "utf8" }),
	"git remotes": execSync("git remote -v", { encoding: "utf8" }),
};

const mask = (line) => line.replace(/([A-Za-z]+_(?:v\d+_|live_|test_)?)[A-Za-z0-9_-]{8,}/g, "$1****");
let failed = false;
for (const [where, text] of Object.entries(sources)) {
	for (const line of text.split("\n")) {
		const hit = PATTERNS.find(([, p]) => p.test(line));
		if (hit) {
			failed = true;
			console.error(`Possible ${hit[0]} in ${where}: ${mask(line)}`);
		}
	}
}
process.exit(failed ? 1 : 0);
