import { append, bufferKey } from "../buffer.ts";
import { COMMIT_COMMAND, eventsFor, type HookInput } from "../adapters/claude-code.ts";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { readFileSync } from "node:fs";
import { checkpoint } from "./checkpoint.ts";
import { settingsPath } from "./adapter.ts";

/**
 * `appmarket hook claude-code|codex`: the harness runs this for each hook event with JSON on stdin (#112).
 * Records only sessions working in an initialised repo, prints nothing (UserPromptSubmit output
 * would be added to the conversation) and always exits 0.
 */
export function hook(harness: string, stdin: string, opts: { plugin?: boolean } = {}): number {
	try {
		if (harness !== "claude-code" && harness !== "codex") return 0;
		// Plugin and `adapter install` both present: the settings hooks record, the plugin's stay quiet.
		if (opts.plugin && harness === "claude-code" && settingsHooksInstalled()) return 0;
		const input = JSON.parse(stdin) as HookInput;
		const root = input.cwd ? repoRoot(input.cwd) : null;
		if (!root) return 0;
		if (!gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root })) return 0;
		if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;
		const key = bufferKey(root);
		const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
		const committed = input.hook_event_name === "PostToolUse" && input.tool_name === "Bash" && COMMIT_COMMAND.test(command);
		// Fast path: an agent commit gets its checkpoint even if the git hook did not run; when the
		// git hook already made one, checkpoint() sees the note and does nothing. The commit call
		// itself is not recorded: it would land in the next commit's checkpoint.
		if (committed) return checkpoint({ hook: true, cwd: root });
		for (const event of eventsFor(input, undefined, root, harness)) append(key, event);
	} catch (error) {
		log("hook claude-code failed", error);
	}
	return 0;
}

function settingsHooksInstalled(): boolean {
	try {
		return readFileSync(settingsPath("claude-code"), "utf8").includes("appmarket hook claude-code");
	} catch {
		return false;
	}
}
