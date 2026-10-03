import type { EffortLevel } from "@appmarket/shared";

/** Normalises a harness's own reasoning setting (Claude Code effort, Codex model_reasoning_effort, Cursor max mode, ...). */
export function effortLevel(raw: string | undefined): EffortLevel {
	const value = (raw ?? "").trim().toLowerCase();
	if (!value) return "unknown";
	if (["minimal", "low"].includes(value)) return "low";
	if (["medium", "default", "normal"].includes(value)) return "medium";
	if (["high", "thinking", "think"].includes(value)) return "high";
	if (["xhigh", "max", "maximum", "max-mode", "ultrathink"].includes(value)) return "max";
	return "unknown";
}
