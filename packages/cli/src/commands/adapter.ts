import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HookHarness = "claude-code" | "codex";

/** The command a harness runs; a machine without the CLI just skips it. */
export const hookCommand = (harness: HookHarness) => `command -v appmarket >/dev/null 2>&1 && appmarket hook ${harness} || true`;
/** Kept for the Claude Code tests and docs. */
export const HOOK_COMMAND = hookCommand("claude-code");

const HARNESSES: Record<HookHarness, { events: readonly string[]; toolMatcher: string; name: string }> = {
	"claude-code": { events: ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "SessionEnd"], toolMatcher: "*", name: "Claude Code" },
	// Codex matchers are regular expressions.
	codex: { events: ["SessionStart", "UserPromptSubmit", "PostToolUse"], toolMatcher: ".*", name: "Codex" },
};

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

// The Claude Code plugin's hooks carry --plugin and live in the plugin, not in settings.json.
const ours = (entry: HookEntry, harness: HookHarness) => entry.hooks.some((h) => h.command.includes(`appmarket hook ${harness}`) && !h.command.includes("--plugin"));

/** Claude Code: ~/.claude/settings.json. Codex: ~/.codex/hooks.json. */
export function settingsPath(harness: HookHarness = "claude-code"): string {
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

/** `appmarket adapter install|uninstall claude-code|codex` */
export function adapter(action: string | undefined, harness: string | undefined): number {
	if ((harness !== "claude-code" && harness !== "codex") || (action !== "install" && action !== "uninstall")) {
		console.error("Usage: appmarket adapter install|uninstall claude-code|codex");
		return 1;
	}
	const path = settingsPath(harness);
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
	writeFileSync(path, JSON.stringify(editHooks(settings, action === "install", harness), null, 2) + "\n");
	const { name } = HARNESSES[harness];
	if (action === "uninstall") console.log(`${name} adapter removed from ${path}.`);
	else {
		console.log(`${name} adapter installed in ${path}${existsSync(`${path}.appmarket-backup`) ? " (backup next to it)" : ""}.`);
		console.log(`New ${name} sessions in repos where you ran \`appmarket init\` now record prompts, tools, model, effort and usage.`);
		// Codex runs user hooks only after you review them once (it remembers each hook's hash).
		if (harness === "codex") console.log("Open Codex and run /hooks to review and trust the three appmarket hooks; until then Codex does not run them.");
	}
	return 0;
}
