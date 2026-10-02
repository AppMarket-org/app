// R22: checks a deploy target is fully configured before CI deploys it, and prints the D1 database
// ID for the migration step. Usage: tsx scripts/preflight.ts <staging|production>
import { ENVIRONMENTS, resolveEnvironment } from "../environments.ts";

const mode = process.argv[2];
if (mode !== "staging" && mode !== "production") {
	console.error("Usage: tsx scripts/preflight.ts <staging|production>");
	process.exit(2);
}
const env = ENVIRONMENTS[resolveEnvironment(mode)];
const missing = [
	!env.database.id && "database.id (create the D1 database, then set its ID)",
	!env.access.teamDomain && "access.teamDomain (Cloudflare Access team domain)",
	!env.access.aud && "access.aud (AUD tag of the /admin Access application)",
].filter(Boolean);
if (missing.length) {
	console.error(`apps/api/environments.ts is not ready for ${mode}:\n- ${missing.join("\n- ")}\nSee docs/deploy-runbook.md.`);
	process.exit(1);
}
console.log(env.database.id);
