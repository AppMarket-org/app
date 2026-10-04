import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The command Claude Code runs; a machine without the CLI just skips it. */
export const HOOK_COMMAND = "command -v appmarket >/dev/null 2>&1 && appmarket hook claude-code || true";
const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "SessionEnd"] as const;

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

// The plugin's hooks carry --plugin and live in the plugin, not in settings.json.
const ours = (entry: HookEntry) => entry.hooks.some((h) => h.command.includes("appmarket hook claude-code") && !h.command.includes("--plugin"));

export function settingsPath(): string {
	return process.env.CLAUDE_SETTINGS ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}

/** Adds (or removes) the appmarket hooks in Claude Code's user settings, leaving every other hook alone. */
export function editHooks(settings: Settings, install: boolean): Settings {
	const hooks = { ...(settings.hooks ?? {}) };
	for (const event of EVENTS) {
		const kept = (hooks[event] ?? []).filter((entry) => !ours(entry));
		if (install) kept.push({ ...(event.startsWith("PostToolUse") ? { matcher: "*" } : {}), hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] });
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}
	const { hooks: _old, ...rest } = settings;
	return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** `appmarket adapter install|uninstall claude-code` */
export function adapter(action: string | undefined, harness: string | undefined): number {
	if (harness !== "claude-code" || (action !== "install" && action !== "uninstall")) {
		console.error("Usage: appmarket adapter install|uninstall claude-code");
		return 1;
	}
	const path = settingsPath();
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
	writeFileSync(path, JSON.stringify(editHooks(settings, action === "install"), null, 2) + "\n");
	console.log(
		action === "install"
			? `Claude Code adapter installed in ${path} (backup: settings.json.appmarket-backup).\nNew Claude Code sessions in repos where you ran \`appmarket init\` now record prompts, tools, model, effort and usage.`
			: `Claude Code adapter removed from ${path}.`,
	);
	return 0;
}
