// DCO (CONTRIBUTING.md): every commit in a pull request carries "Signed-off-by:" with its author's
// email. Usage: node scripts/check-dco.mjs <base-sha> <head-sha>. Merge commits and GitHub bots are skipped.
import { execFileSync } from "node:child_process";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
	console.error("Usage: node scripts/check-dco.mjs <base-sha> <head-sha>");
	process.exit(2);
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const commits = git("rev-list", "--no-merges", `${base}..${head}`).split("\n").filter(Boolean);
const missing = [];
for (const sha of commits) {
	const [email, name, ...body] = git("show", "-s", "--format=%ae%n%an%n%B", sha).split("\n");
	if (/\[bot\]@users\.noreply\.github\.com$/i.test(email)) continue;
	const signed = body.some((line) => {
		const match = /^Signed-off-by:\s*.+<([^>]+)>\s*$/i.exec(line.trim());
		return match && match[1].toLowerCase() === email.toLowerCase();
	});
	if (!signed) missing.push(`${sha.slice(0, 7)} ${name} <${email}>`);
}
if (missing.length) {
	console.error(`These commits have no DCO sign-off matching their author:\n  ${missing.join("\n  ")}\n`);
	console.error("Sign them and push again:\n  git rebase --signoff <base-branch>\n  git push --force-with-lease\nSee CONTRIBUTING.md (Sign your commits).");
	process.exit(1);
}
console.log(`DCO: ${commits.length} commit${commits.length === 1 ? "" : "s"} signed off.`);
