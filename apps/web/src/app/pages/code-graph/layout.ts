import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';

/** A node drawn on the map: a file, or a folder of files in a large repo. */
export interface MapNode extends SimulationNodeDatum {
  id: string;
  label: string;
  /** Top-level folder, for its colour. */
  group: string;
  /** Files it stands for (1 for a file). */
  files: number;
  symbols: number;
  kind: 'file' | 'folder';
  x: number;
  y: number;
}

export interface MapEdge {
  source: string;
  target: string;
  weight: number;
}

/** Repos with more files than this start as a map of folders; a folder opens to its files. */
export const FILE_LIMIT = 400;

/** The colour group: the first two folders (apps/api, packages/cli), so a monorepo's parts differ. */
export const topFolder = (path: string) => {
  const parts = path.split('/').slice(0, -1);
  return parts.length ? parts.slice(0, 2).join('/') : '(root)';
};
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '(root)');

/**
 * Nodes and edges for the map: every file (or, over FILE_LIMIT and outside `open`, every folder),
 * with imports between them added up.
 */
export function buildGraph(files: { path: string; symbols: number }[], edges: [string, string][], open: string | null): { nodes: MapNode[]; edges: MapEdge[]; grouped: boolean } {
  const grouped = files.length > FILE_LIMIT;
  const keyOf = (path: string) => (!grouped || (open && folderOf(path) === open) ? path : folderOf(path));
  const nodes = new Map<string, MapNode>();
  for (const f of files) {
    const id = keyOf(f.path);
    const n = nodes.get(id);
    if (n) {
      n.files++;
      n.symbols += f.symbols;
    } else {
      const folder = id !== f.path;
      nodes.set(id, { id, label: folder ? `${id.split('/').pop()}/` : (f.path.split('/').pop() ?? f.path), group: topFolder(f.path), files: 1, symbols: f.symbols, kind: folder ? 'folder' : 'file', x: 0, y: 0 });
    }
  }
  const weights = new Map<string, MapEdge>();
  for (const [a, b] of edges) {
    const s = keyOf(a);
    const t = keyOf(b);
    if (s === t || !nodes.has(s) || !nodes.has(t)) continue;
    const key = `${s}\n${t}`;
    const e = weights.get(key);
    if (e) e.weight++;
    else weights.set(key, { source: s, target: t, weight: 1 });
  }
  return { nodes: [...nodes.values()], edges: [...weights.values()], grouped };
}

/** Lays the map out: linked nodes pull together, folders gather around their own spot. Synchronous, deterministic. */
export function layout(nodes: MapNode[], edges: MapEdge[], size: { width: number; height: number }): void {
  const groups = [...new Set(nodes.map((n) => n.group))].sort();
  const anchor = new Map(
    groups.map((g, i) => {
      const angle = (2 * Math.PI * i) / Math.max(groups.length, 1);
      const r = groups.length > 1 ? Math.min(size.width, size.height) * 0.3 : 0;
      return [g, { x: size.width / 2 + r * Math.cos(angle), y: size.height / 2 + r * Math.sin(angle) }];
    }),
  );
  // Start on the folder's spot, spread a little by index, so the result does not depend on randomness.
  nodes.forEach((n, i) => {
    const a = anchor.get(n.group)!;
    n.x = a.x + Math.cos(i) * 30;
    n.y = a.y + Math.sin(i) * 30;
  });
  const links: SimulationLinkDatum<MapNode>[] = edges.map((e) => ({ source: e.source, target: e.target }));
  forceSimulation(nodes)
    .force('link', forceLink<MapNode, SimulationLinkDatum<MapNode>>(links).id((n) => n.id).distance(45).strength(0.4))
    .force('charge', forceManyBody().strength(-70))
    .force('collide', forceCollide<MapNode>().radius((n) => radius(n) + 3))
    .force('x', forceX<MapNode>((n) => anchor.get(n.group)!.x).strength(0.08))
    .force('y', forceY<MapNode>((n) => anchor.get(n.group)!.y).strength(0.08))
    .stop()
    .tick(300);
}

export const radius = (n: Pick<MapNode, 'symbols' | 'files' | 'kind'>) => (n.kind === 'folder' ? 7 + Math.sqrt(n.files) * 2.2 : 4 + Math.min(Math.sqrt(n.symbols) * 1.6, 12));

/** The view box (at the map's aspect ratio) that shows these nodes, with room around them. */
export function fit(nodes: MapNode[], size: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  if (!nodes.length) return { x: 0, y: 0, w: size.width, h: size.height };
  const pad = 60;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  let x = Math.min(...xs) - pad;
  let y = Math.min(...ys) - pad;
  let w = Math.max(...xs) + pad - x;
  let h = Math.max(...ys) + pad - y;
  const ratio = size.width / size.height;
  if (w / h > ratio) {
    const nh = w / ratio;
    y -= (nh - h) / 2;
    h = nh;
  } else {
    const nw = h * ratio;
    x -= (nw - w) / 2;
    w = nw;
  }
  return { x, y, w, h };
}
