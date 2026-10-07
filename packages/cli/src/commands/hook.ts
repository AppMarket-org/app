import { append, bufferKey } from "../buffer.ts";
import { COMMIT_COMMAND, eventsFor, lastReply, type HookInput } from "../adapters/claude-code.ts";
import { finishSummaries } from "../summaries.ts";
import { cursorCommitted, cursorDirectory, cursorEvents, type CursorInput } from "../adapters/cursor.ts";
import { opencodeEvents, type OpencodeInput } from "../adapters/opencode.ts";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { readFileSync } from "node:fs";
import { checkpoint } from "./checkpoint.ts";
import { settingsPath } from "./adapter.ts";
import { sessionStartContext } from "./memory.ts";

/**
 * `appmarket hook claude-code|codex|opencode|cursor`: the harness runs this for each hook event with JSON on stdin
 * (#112; OpenCode's plugin sends its own shape, #119).
 * Records only sessions working in an initialised repo and always exits 0. It prints nothing
 * (UserPromptSubmit output would be added to the conversation) except at SessionStart, where the
 * repo's memory (#196) is added to the agent's context.
 */
export async function hook(harness: string, stdin: string, opts: { plugin?: boolean } = {}): Promise<number> {
	try {
		if (harness === "opencode") return opencodeHook(JSON.parse(stdin) as OpencodeInput);
		if (harness === "cursor") return await cursorHook(JSON.parse(stdin) as CursorInput);
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
		// The turn ended: its final reply becomes the summary of the commits it made.
		if (input.hook_event_name === "Stop") {
			if (harness === "claude-code" && input.session_id) finishSummaries(root, input.session_id, input.last_assistant_message || lastReply(input.transcript_path));
			return 0;
		}
		for (const event of eventsFor(input, undefined, root, harness)) append(key, event);
		if (input.hook_event_name === "SessionStart") {
			const context = await sessionStartContext(root);
			if (context) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } })}\n`);
		}
	} catch (error) {
		log("hook claude-code failed", error);
	}
	return 0;
}

/**
 * #120: one Cursor hook. Cursor reads the hook's stdout: a prompt hook answers that the prompt may go
 * ahead, and sessionStart adds the repo's memory to the agent's context.
 */
async function cursorHook(input: CursorInput): Promise<number> {
	try {
		const directory = cursorDirectory(input);
		const root = directory ? repoRoot(directory) : null;
		if (!root || !gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root })) return 0;
		if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;
		if (cursorCommitted(input)) return checkpoint({ hook: true, cwd: root });
		const key = bufferKey(root);
		for (const event of cursorEvents(input, root)) append(key, event);
		if (input.hook_event_name === "afterAgentResponse" && input.conversation_id && input.text) finishSummaries(root, input.conversation_id, input.text);
		if (input.hook_event_name === "sessionStart") {
			const context = await sessionStartContext(root);
			if (context) process.stdout.write(`${JSON.stringify({ additional_context: context })}\n`);
		}
	} finally {
		if (input.hook_event_name === "beforeSubmitPrompt") process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
	}
	return 0;
}

/** #119: one event from the OpenCode plugin. An agent's `git commit` gets its checkpoint right away. */
function opencodeHook(input: OpencodeInput): number {
	const root = input.directory ? repoRoot(input.directory) : null;
	if (!root) return 0;
	if (!gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root })) return 0;
	if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;
	const command = typeof input.args?.command === "string" ? input.args.command : "";
	if (input.event === "tool" && input.tool === "bash" && !input.error && COMMIT_COMMAND.test(command)) return checkpoint({ hook: true, cwd: root });
	const key = bufferKey(root);
	for (const event of opencodeEvents(input, root)) append(key, event);
	if (input.event === "assistant" && input.sessionID && input.text) finishSummaries(root, input.sessionID, input.text);
	return 0;
}

function settingsHooksInstalled(): boolean {
	try {
		return readFileSync(settingsPath("claude-code"), "utf8").includes("appmarket hook claude-code");
	} catch {
		return false;
	}
}
