import { parseArgs } from "node:util";
import { apiBase, VERSION } from "./config.ts";
import { log } from "./log.ts";
import { flush } from "./queue.ts";
import { login, loginWithToken } from "./commands/login.ts";
import { logout, whoami } from "./commands/account.ts";
import { init, setEnabled } from "./commands/init.ts";
import { record } from "./commands/record.ts";
import { checkpoint } from "./commands/checkpoint.ts";
import { adapter } from "./commands/adapter.ts";
import { hook } from "./commands/hook.ts";
import { mcp } from "./commands/mcp.ts";
import { rewritten } from "./commands/rewritten.ts";
import { pushNotes } from "./commands/notes.ts";
import { doctor, status, updateNotice } from "./commands/doctor.ts";
import { gitCredential, sessionEnd, sessionList, sessionStart } from "./commands/session.ts";
import { setupGit } from "./commands/setup-git.ts";
import { issue } from "./commands/issue.ts";
import { pr } from "./commands/pr.ts";

const HELP = `appmarket ${VERSION}: checkpoints for agent commits on appmarket.org

Usage: appmarket <command> [options]

  login [--no-browser] [--device-name <name>] [--no-keychain]   Sign in with a device code
  login --token <token|->                                        Sign in with a CI token (or set APPMARKET_TOKEN)
  logout                                                         Sign this device out
  whoami                                                         Account, device, scopes, expiry
  init [<owner>/<repo>] [--agents-md]                            Turn on checkpoints in this Git repo
  disable | enable                                               Pause or resume checkpoints here
  record [--prompt <text>] [--tool <name> --args <a>] [--for <sha>]   Add events (adapters pipe JSON on stdin)
  checkpoint [--commit <sha>] [--force]                          Checkpoint a commit (the git hook runs this)
  mcp                                                            MCP server (stdio) with record_context, for agents without hooks
  adapter install|uninstall claude-code|codex                    Record agent sessions (prompts, tools, model, effort, usage)
  sync                                                           Upload queued checkpoints now
  push-notes                                                     Push refs/notes/appmarket to the appmarket remote (runs after each checkpoint)
  session start [<owner>/<repo>] [--harness <name>]              Start an agent session: its own branches in the repo, protected branches off limits
  session end [<id>] [--discard]                                 End it (revokes its sign-in) or discard it (also deletes its branches)
  session list [<owner>/<repo>]                                  Agent sessions of this repo
  pr create [--title t] [--body b] [--base branch]                 Open a pull request for this branch (to the repo it was forked from, for forks)
  pr list [--state open|merged|closed|all] | view [n] | merge [n]  Pull requests of this repo; view and merge default to this branch's
  issue create --title t [--type bug|feature|task] [--priority p] [--assign agents|<handle>] [--body b]   Open an issue
  issue list [--state open|closed|all] [--type t] [--assign a] | view <n> | comment <n> --body b | close <n> [--not-planned] | reopen <n>
  setup-git [--remove]                                           Let plain git sign in to appmarket.org remotes with this login (no tokens to copy)
  git-credential get                                             Git credential helper (set up by setup-git and session start)
  status                                                         Queue, last upload, checkpoints waiting for a push
  doctor                                                         Check hooks, sign-in, connection and adapters

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
			token: { type: "string" },
			hook: { type: "boolean" },
			force: { type: "boolean" },
			plugin: { type: "boolean" },
			discard: { type: "boolean" },
			remove: { type: "boolean" },
			title: { type: "string" },
			body: { type: "string" },
			base: { type: "string" },
			state: { type: "string" },
			type: { type: "string" },
			priority: { type: "string" },
			assign: { type: "string" },
			"not-planned": { type: "boolean" },
			"agents-md": { type: "boolean" },
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
	if (!["checkpoint", "record", "sync", "hook", "mcp", "rewritten", "push-notes"].includes(command)) {
		await flush().catch(() => undefined);
		await updateNotice().catch(() => undefined);
	}
	switch (command) {
		case "login":
			// #134: --token reads the token from the next argument or, with "-", from stdin (keeps it out of shell history).
			if (values.token !== undefined) {
				const token = values.token === "-" || values.token === true ? (await readStdin()).trim() : String(values.token);
				return loginWithToken(api, token, { noKeychain: !!values["no-keychain"] });
			}
			return login(api, { noBrowser: !!values["no-browser"], deviceName: values["device-name"] as string | undefined, noKeychain: !!values["no-keychain"] });
		case "logout":
			return logout(api);
		case "whoami":
			return whoami(api);
		case "init":
			return init(api, rest[0], { agentsMd: !!values["agents-md"] });
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
		case "mcp":
			return mcp();
		case "push-notes":
			return pushNotes();
		case "rewritten":
			return rewritten(rest[0] ?? "", await readStdin());
		case "adapter":
			return adapter(rest[0], rest[1]);
		case "sync": {
			const r = await flush({ all: !values.quiet });
			if (!values.quiet) console.log(`Uploaded ${r.sent}, waiting ${r.pending}, dropped ${r.failed}.`);
			return 0;
		}
		case "session":
			if (rest[0] === "start") return sessionStart(api, rest[1], values.harness as string | undefined);
			if (rest[0] === "end") return sessionEnd(api, rest[1], !!values.discard);
			if (rest[0] === "list") return sessionList(api, rest[1]);
			console.error("Usage: appmarket session start|end|list");
			return 1;
		case "git-credential":
			return gitCredential(rest[0], await readStdin(), api);
		case "pr":
			return pr(rest[0], rest.slice(1), { title: values.title as string | undefined, body: values.body as string | undefined, base: values.base as string | undefined, state: values.state as string | undefined });
		case "issue":
			return issue(rest[0], rest.slice(1), {
				title: values.title as string | undefined,
				body: values.body as string | undefined,
				type: values.type as string | undefined,
				priority: values.priority as string | undefined,
				assign: values.assign as string | undefined,
				state: values.state as string | undefined,
				notPlanned: !!values["not-planned"],
			});
		case "setup-git":
			return setupGit(api, !!values.remove);
		case "status":
			return status(api);
		case "doctor":
			return doctor(api);
		default:
			console.error(`Unknown command: ${command}\n\n${HELP}`);
			return 1;
	}
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		log("command failed", error);
		const api = apiBase(process.argv.find((a, i) => process.argv[i - 1] === "--api"));
		const offline = error instanceof TypeError || (error instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(`${error.message} ${String(error.cause ?? "")}`));
		console.error(offline ? `Could not reach ${api}. Check your connection, or point the CLI at another server with --api <url> or APPMARKET_API.` : error instanceof Error ? error.message : String(error));
		process.exit(1);
	},
);
