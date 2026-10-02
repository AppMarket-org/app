// Local development only: signs in a test user against the local D1 state that `cf dev` uses,
// without Google or GitHub. Prints a Cookie header value for curl or the browser.
//
//   pnpm --filter @appmarket/api dev:login [email] [buyer|developer|admin]
//
// Refuses to run unless .dev.vars exists and the local D1 file is found. Never use against remote data.
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, type Role } from "@appmarket/shared";
import { authOptions } from "../src/auth/options.ts";

const [email = "dev@example.test", role = "developer"] = process.argv.slice(2);
if (!ROLES.includes(role as Role)) throw new Error(`Role must be one of ${ROLES.join(", ")}`);

const vars = Object.fromEntries(
	readFileSync(".dev.vars", "utf8")
		.split("\n")
		.filter((line) => /^[A-Z_]+=/.test(line))
		.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const dir = ".cloudflare/state/v3/d1/miniflare-D1DatabaseObject";
const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (!file) throw new Error("Local D1 not found. Run `pnpm db:migrate` first.");

const options = authOptions(new Database(join(dir, file)), {
	baseURL: "http://localhost:4200",
	secret: vars.BETTER_AUTH_SECRET,
	google: { clientId: "unused", clientSecret: "unused" },
	github: { clientId: "unused", clientSecret: "unused" },
	turnstileSecretKey: "unused",
});
const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
const test = (await auth.$context).test;

const existing = await (await auth.$context).internalAdapter.findUserByEmail(email);
const user = existing?.user ?? (await test.saveUser(test.createUser({ email, name: email.split("@")[0], role })));
// The internal adapter's return type omits additional fields such as role.
if (existing && (existing.user as { role?: string }).role !== role) {
	await (await auth.$context).internalAdapter.updateUser(user.id, { role });
}
const { headers } = await test.login({ userId: user.id });
process.stdout.write(`${headers.get("cookie")}\n`);
