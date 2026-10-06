import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { repoRoot } from "../git.ts";
import { editCursorHooks } from "../adapters/cursor.ts";
import { editOpencodeConfig, OPENCODE_PLUGIN, opencodeDir, opencodePluginPath } from "../adapters/opencode.ts";

export type HookHarness = "claude-code" | "codex" | "cursor";

/** The command a harness runs; a machine without the CLI just skips it. */
export const hookCommand = (harness: HookHarness) => `command -v appmarket >/dev/null 2>&1 && appmarket hook ${harness} || true`;
/** Kept for the Claude Code tests and docs. */
export const HOOK_COMMAND = hookCommand("claude-code");

const HARNESSES: Record<HookHarness, { events: readonly string[]; toolMatcher: string; name: string }> = {
	"claude-code": { events: ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "SessionEnd"], toolMatcher: "*", name: "Claude Code" },
	// Codex matchers are regular expressions.
	codex: { events: ["SessionStart", "UserPromptSubmit", "PostToolUse"], toolMatcher: ".*", name: "Codex" },
	// #120: Cursor's own hooks.json shape (editCursorHooks); events listed in adapters/cursor.ts.
	cursor: { events: [], toolMatcher: "", name: "Cursor" },
};

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

// The Claude Code plugin's hooks carry --plugin and live in the plugin, not in settings.json.
const ours = (entry: HookEntry, harness: HookHarness) => entry.hooks.some((h) => h.command.includes(`appmarket hook ${harness}`) && !h.command.includes("--plugin"));

/** Claude Code: ~/.claude/settings.json. Codex: ~/.codex/hooks.json. Cursor: ~/.cursor/hooks.json (or the repo's .cursor/hooks.json). */
export function settingsPath(harness: HookHarness = "claude-code", projectRoot?: string): string {
	if (harness === "cursor") return join(projectRoot ?? homedir(), ".cursor", "hooks.json");
	if (harness === "codex") return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "hooks.json");
	return process.env.CLAUDE_SETTINGS ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}

/** Adds (or removes) the appmarket hooks, leaving every other hook alone. */
export function editHooks(settings: Settings, install: boolean, harness: HookHarness = "claude-code"): Settings {
	const { events, toolMatcher } = HARNESSES[harness];
	const hooks = { ...(settings.hooks ?? {}) };
	for (const event of events) {
		const kept = (hooks[event] ?? []).filter((entry) => !ours(entry, harness));
		if (install) kept.push({ ...(event.startsWith("PostToolUse") ? { matcher: toolMatcher } : {}), hooks: [{ type: "command", command: hookCommand(harness), timeout: 10 }] });
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}
	const { hooks: _old, ...rest } = settings;
	return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** `appmarket adapter install|uninstall claude-code|codex|opencode|cursor [--project]` */
export function adapter(action: string | undefined, harness: string | undefined, opts: { project?: boolean } = {}): number {
	if ((harness !== "claude-code" && harness !== "codex" && harness !== "opencode" && harness !== "cursor") || (action !== "install" && action !== "uninstall")) {
		console.error("Usage: appmarket adapter install|uninstall claude-code|codex|opencode|cursor [--project (cursor: this repo only)]");
		return 1;
	}
	if (harness === "opencode") return opencodeAdapter(action === "install");
	let projectRoot: string | undefined;
	if (opts.project) {
		if (harness !== "cursor") return (console.error("--project is for Cursor (a repo's .cursor/hooks.json)."), 1);
		projectRoot = repoRoot() ?? undefined;
		if (!projectRoot) return (console.error("Run this inside the repo's Git checkout."), 1);
	}
	const path = settingsPath(harness, projectRoot);
	let settings: Settings = {};
	if (existsSync(path)) {
		try {
			settings = JSON.parse(readFileSync(path, "utf8")) as Settings;
		} catch {
			console.error(`${path} is not valid JSON; fix it first.`);
			return 1;
		}
		copyFileSync(path, `${path}.appmarket-backup`);
	} else mkdirSync(dirname(path), { recursive: true });
	const edited = harness === "cursor" ? editCursorHooks(settings as Parameters<typeof editCursorHooks>[0], action === "install", hookCommand("cursor")) : editHooks(settings, action === "install", harness);
	writeFileSync(path, JSON.stringify(edited, null, 2) + "\n");
	const { name } = HARNESSES[harness];
	if (action === "uninstall") console.log(`${name} adapter removed from ${path}.`);
	else {
		console.log(`${name} adapter installed in ${path}${existsSync(`${path}.appmarket-backup`) ? " (backup next to it)" : ""}.`);
		console.log(`New ${name} sessions in repos where you ran \`appmarket init\` now record prompts, tools, model, effort${harness === "cursor" ? " and the final answer" : " and usage"}.`);
		// Codex runs user hooks only after you review them once (it remembers each hook's hash).
		if (harness === "codex") console.log("Open Codex and run /hooks to review and trust the three appmarket hooks; until then Codex does not run them.");
		if (harness === "cursor") console.log("Cursor gives hooks no token usage, so its checkpoints have none. Restart Cursor to load the hooks.");
	}
	return 0;
}

/**
 * #119: OpenCode has no hooks file; the adapter is a plugin in ~/.config/opencode/plugins plus the
 * `appmarket mcp` server in opencode.json (memory, issues and record_context for the agent).
 */
function opencodeAdapter(install: boolean): number {
	const plugin = opencodePluginPath();
	const json = join(opencodeDir(), "opencode.json");
	const jsonc = join(opencodeDir(), "opencode.jsonc");
	// A commented config cannot be edited safely; say what to add instead.
	const manual = !existsSync(json) && existsSync(jsonc);
	let config: Record<string, unknown> = {};
	if (!manual && existsSync(json)) {
		try {
			config = JSON.parse(readFileSync(json, "utf8")) as Record<string, unknown>;
		} catch {
			console.error(`${json} is not valid JSON; fix it first.`);
			return 1;
		}
	}
	if (install) {
		mkdirSync(dirname(plugin), { recursive: true });
		writeFileSync(plugin, OPENCODE_PLUGIN);
	} else rmSync(plugin, { force: true });
	if (!manual && (install || existsSync(json))) {
		if (existsSync(json)) copyFileSync(json, `${json}.appmarket-backup`);
		writeFileSync(json, JSON.stringify(editOpencodeConfig(config, install), null, 2) + "\n");
	}
	if (!install) {
		console.log(`OpenCode adapter removed (${plugin}${manual ? "" : `, and the appmarket MCP server in ${json}`}).`);
		if (manual) console.log(`Remove the "appmarket" entry under "mcp" in ${jsonc} yourself.`);
		return 0;
	}
	console.log(`OpenCode adapter installed: plugin ${plugin}${manual ? "" : `, MCP server in ${json}`}.`);
	if (manual) console.log(`Add the MCP server to ${jsonc} yourself: "mcp": { "appmarket": { "type": "local", "command": ["appmarket", "mcp"], "enabled": true } }`);
	console.log("New OpenCode sessions in repos where you ran `appmarket init` now record prompts, tools, model, effort and usage.");
	return 0;
}
