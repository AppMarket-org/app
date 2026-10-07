import type { Checkpoint, CheckpointSummary, CheckpointVisibility, Harness } from '@appmarket/shared';

export const HARNESS_LABELS: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  mcp: 'Agent (MCP)',
  none: 'Manual',
};

export const VISIBILITY_LABELS: Record<CheckpointVisibility, { label: string; help: string; icon: string }> = {
  private: { label: 'Private', help: 'Only you and your organization see prompts', icon: 'lock' },
  listing: { label: 'On the app page', help: 'Shown in the build history on the app page', icon: 'storefront' },
  public: { label: 'Public', help: 'Anyone who can see the repo sees prompts', icon: 'public' },
};

export interface SessionGroup {
  /** The session id, or '' for commits made outside an agent session. */
  session: string;
  harness: Harness;
  items: Checkpoint[];
}

/** Consecutive checkpoints of the same session, newest first (a session can resume after a manual commit). */
export function groupBySession(items: Checkpoint[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.session === item.session_id && last.harness === item.harness) last.items.push(item);
    else groups.push({ session: item.session_id, harness: item.harness, items: [item] });
  }
  return groups;
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

/** "3 prompts, 14 min, 41 tool calls, 212k tokens" (PRD effort line); empty for manual commits. */
export function effortLine(c: Checkpoint): string {
  if (c.harness === 'none') return '';
  const m = c.effort_metrics;
  const parts = [`${m.turns} prompt${m.turns === 1 ? '' : 's'}`, duration(m.wall_clock_s), `${m.tool_calls} tool call${m.tool_calls === 1 ? '' : 's'}`];
  const tokens = (c.usage?.input_tokens ?? 0) + (c.usage?.output_tokens ?? 0);
  if (tokens) parts.push(`${compact(tokens)} tokens`);
  // ~ marks an estimate from appmarket.org's price table (#127) rather than the harness's own figure.
  if (c.usage?.cost_usd != null) parts.push(`${c.usage.cost_priced ? '~' : ''}$${c.usage.cost_usd < 0.01 ? c.usage.cost_usd.toFixed(4) : c.usage.cost_usd.toFixed(2)}`);
  if (m.retries) parts.push(`${m.retries} retr${m.retries === 1 ? 'y' : 'ies'}`);
  return parts.join(', ');
}

/** "38 commits, 31 by Claude Code, 7 manual" (PRD build history summary). */
export function summaryLine(summary: CheckpointSummary): string {
  const parts = [`${summary.total} commit${summary.total === 1 ? '' : 's'}`];
  const entries = Object.entries(summary.harnesses) as [Harness, number][];
  for (const [harness, n] of entries.filter(([h]) => h !== 'none').sort((a, b) => b[1] - a[1])) parts.push(`${n} by ${HARNESS_LABELS[harness]}`);
  if (summary.harnesses.none) parts.push(`${summary.harnesses.none} manual`);
  return parts.join(', ');
}

/** "Built with Claude Code and Codex": the agent harnesses, most used first. */
export function builtWith(summary: CheckpointSummary): string {
  const names = (Object.entries(summary.harnesses) as [Harness, number][]).filter(([h]) => h !== 'none').sort((a, b) => b[1] - a[1]).map(([h]) => HARNESS_LABELS[h]);
  if (!names.length) return '';
  return `Built with ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}`;
}

export interface ToolGroup {
  name: string;
  calls: number;
  errors: number;
  /** What it was called on, most used first: a file name, a command, a pattern. */
  targets: { label: string; count: number }[];
  /** Targets beyond those listed. */
  more: number;
}

const TOOL_TARGETS = 4;

/** A path's file name; anything else (a command, a pattern) shortened to its first 48 characters. */
function target(args: string): string {
  const text = args.trim();
  if (!text) return '';
  if (!/\s/.test(text) && /[/.]/.test(text)) return text.split('/').pop() || text;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** A checkpoint's tool calls summed up per tool, in the order each was first used. */
export function toolGroups(tools: NonNullable<Checkpoint['tools']>): ToolGroup[] {
  const groups = new Map<string, { calls: number; errors: number; targets: Map<string, number> }>();
  for (const t of tools) {
    const g = groups.get(t.name) ?? { calls: 0, errors: 0, targets: new Map<string, number>() };
    g.calls++;
    if (t.outcome === 'error') g.errors++;
    const label = target(t.args_summary);
    if (label) g.targets.set(label, (g.targets.get(label) ?? 0) + 1);
    groups.set(t.name, g);
  }
  return [...groups].map(([name, g]) => {
    const targets = [...g.targets].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    return { name, calls: g.calls, errors: g.errors, targets: targets.slice(0, TOOL_TARGETS), more: Math.max(0, targets.length - TOOL_TARGETS) };
  });
}

/** Material Symbols for common agent tools; others get a generic one. */
export function toolIcon(name: string): string {
  const n = name.toLowerCase();
  if (/^(edit|write|multiedit|apply_patch|notebookedit)/.test(n)) return 'edit';
  if (/^(read|view)/.test(n)) return 'description';
  if (/^(bash|shell|exec|run|terminal)/.test(n)) return 'terminal';
  if (/^(grep|glob|search|find|list|ls)/.test(n)) return 'search';
  if (/^(web|fetch)/.test(n)) return 'public';
  if (n.startsWith('mcp__') || n.includes('mcp')) return 'extension';
  if (/^(task|agent)/.test(n)) return 'smart_toy';
  return 'build';
}
