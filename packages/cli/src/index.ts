import { parseArgs } from "node:util";
import { apiBase, VERSION } from "./config.ts";
import { log } from "./log.ts";
import { flush, queued } from "./queue.ts";
import { login } from "./commands/login.ts";
import { logout, whoami } from "./commands/account.ts";
import { init, setEnabled } from "./commands/init.ts";
import { record } from "./commands/record.ts";
import { checkpoint } from "./commands/checkpoint.ts";
import { adapter } from "./commands/adapter.ts";
import { hook } from "./commands/hook.ts";

const HELP = `appmarket ${VERSION}: checkpoints for agent commits on appmarket.org

Usage: appmarket <command> [options]

  login [--no-browser] [--device-name <name>] [--no-keychain]   Sign in with a device code
  logout                                                         Sign this device out
  whoami                                                         Account, device, scopes, expiry
  init [<owner>/<repo>]                                          Turn on checkpoints in this Git repo
  disable | enable                                               Pause or resume checkpoints here
  record [--prompt <text>] [--tool <name> --args <a>] [--for <sha>]   Add events (adapters pipe JSON on stdin)
  checkpoint [--commit <sha>] [--force]                          Checkpoint a commit (the git hook runs this)
  adapter install|uninstall claude-code                          Record Claude Code sessions (prompts, tools, model, effort, usage)
  sync                                                           Upload queued checkpoints now
  status                                                         Queue and sign-in state

Options: --api <url> (default https://appmarket.org, or APPMARKET_API)`;

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
	const { positionals, values } = parseArgs({
		args: argv,
		allowPositionals: true,
		strict: false,
		options: {
			api: { type: "string" },
			"no-browser": { type: "boolean" },
			"device-name": { type: "string" },
			"no-keychain": { type: "boolean" },
			hook: { type: "boolean" },
			force: { type: "boolean" },
			plugin: { type: "boolean" },
			commit: { type: "string" },
			prompt: { type: "string" },
			tool: { type: "string" },
			args: { type: "string" },
			outcome: { type: "string" },
			session: { type: "string" },
			harness: { type: "string" },
			for: { type: "string" },
			cwd: { type: "string" },
			quiet: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
	const [command, ...rest] = positionals;
	const api = apiBase(typeof values.api === "string" ? values.api : undefined);
	if (values.version) return (console.log(VERSION), 0);
	if (!command || values.help) return (console.log(HELP), 0);
	// C8: queued uploads go out at the start of every interactive command.
	if (!["checkpoint", "record", "sync", "hook"].includes(command)) await flush().catch(() => undefined);
	switch (command) {
		case "login":
			return login(api, { noBrowser: !!values["no-browser"], deviceName: values["device-name"] as string | undefined, noKeychain: !!values["no-keychain"] });
		case "logout":
			return logout(api);
		case "whoami":
			return whoami(api);
		case "init":
			return init(api, rest[0]);
		case "disable":
			return setEnabled(false);
		case "enable":
			return setEnabled(true);
		case "record":
			return record(values as Record<string, string | boolean | undefined>, await readStdin());
		case "checkpoint":
			return checkpoint({ hook: !!values.hook, commit: values.commit as string | undefined, force: !!values.force });
		case "hook":
			return hook(rest[0] ?? "", await readStdin(), { plugin: !!values.plugin });
		case "adapter":
			return adapter(rest[0], rest[1]);
		case "sync": {
			const r = await flush({ all: !values.quiet });
			if (!values.quiet) console.log(`Uploaded ${r.sent}, waiting ${r.pending}, dropped ${r.failed}.`);
			return 0;
		}
		case "status": {
			const items = queued();
			console.log(`Server: ${api}\nQueued checkpoints: ${items.length}${items.length ? ` (oldest ${items.map((i) => i.firstAt).sort()[0]})` : ""}`);
			return whoami(api);
		}
		default:
			console.error(`Unknown command: ${command}\n\n${HELP}`);
			return 1;
	}
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		log("command failed", error);
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	},
);
