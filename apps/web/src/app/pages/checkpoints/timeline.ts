import type { Checkpoint, CheckpointVisibility, Harness } from '@appmarket/shared';

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
  if (m.retries) parts.push(`${m.retries} retr${m.retries === 1 ? 'y' : 'ies'}`);
  return parts.join(', ');
}
