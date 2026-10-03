// R22: prints the Worker secrets file for `cf deploy --secrets-file` from environment variables
// (set from the GitHub environment's secrets). Every secret the Worker declares must be present for
// a deploy; unset ones get a placeholder and the deploy log lists them by name only.
const NAMES = [
	"BETTER_AUTH_SECRET",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"GITHUB_CLIENT_ID",
	"GITHUB_CLIENT_SECRET",
	"TURNSTILE_SECRET_KEY",
	"DOWNLOAD_SIGNING_KEY",
	"CF_OAUTH_CLIENT_ID",
	"CF_OAUTH_CLIENT_SECRET",
	"CF_TOKEN_ENCRYPTION_KEY",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
];
/** Keys that sign sessions, download links and encrypt buyer tokens: never deployed as placeholders. */
const REQUIRED = ["BETTER_AUTH_SECRET", "DOWNLOAD_SIGNING_KEY", "CF_TOKEN_ENCRYPTION_KEY"];
const PLACEHOLDER = "not-configured";
const absent = REQUIRED.filter((name) => !process.env[name]);
if (absent.length) {
	console.error(`Refusing to deploy without ${absent.join(", ")} (set them in the GitHub environment).`);
	process.exit(1);
}
const missing = NAMES.filter((name) => !process.env[name]);
if (missing.length) console.error(`Not configured yet (placeholder deployed): ${missing.join(", ")}`);
process.stdout.write(JSON.stringify(Object.fromEntries(NAMES.map((name) => [name, process.env[name] || PLACEHOLDER]))));
