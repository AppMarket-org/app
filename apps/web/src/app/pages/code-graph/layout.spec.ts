import { buildGraph, fit, FILE_LIMIT, layout, topFolder } from './layout';

describe('code graph layout', () => {
  const files = [
    { path: 'src/a.ts', symbols: 3 },
    { path: 'src/b.ts', symbols: 1 },
    { path: 'test/a.test.ts', symbols: 0 },
  ];
  const edges: [string, string][] = [
    ['src/a.ts', 'src/b.ts'],
    ['test/a.test.ts', 'src/a.ts'],
    ['src/a.ts', 'src/b.ts'],
  ];

  it('draws every file of a small repo, with imports added up', () => {
    const g = buildGraph(files, edges, null);
    expect(g.grouped).toBe(false);
    expect(g.nodes.map((n) => [n.id, n.label, n.group, n.kind])).toEqual([
      ['src/a.ts', 'a.ts', 'src', 'file'],
      ['src/b.ts', 'b.ts', 'src', 'file'],
      ['test/a.test.ts', 'a.test.ts', 'test', 'file'],
    ]);
    expect(g.edges).toEqual([
      { source: 'src/a.ts', target: 'src/b.ts', weight: 2 },
      { source: 'test/a.test.ts', target: 'src/a.ts', weight: 1 },
    ]);
  });

  it('groups a large repo by folder, and opens one folder to its files', () => {
    const many = Array.from({ length: FILE_LIMIT + 1 }, (_, i) => ({ path: `pkg/${i % 2 ? 'x' : 'y'}/f${i}.ts`, symbols: 1 }));
    const grouped = buildGraph(many, [['pkg/x/f1.ts', 'pkg/y/f0.ts']], null);
    expect(grouped.grouped).toBe(true);
    expect(grouped.nodes.map((n) => [n.id, n.kind, n.files, n.label])).toEqual([
      ['pkg/y', 'folder', 201, 'y/'],
      ['pkg/x', 'folder', 200, 'x/'],
    ]);
    expect(grouped.edges).toEqual([{ source: 'pkg/x', target: 'pkg/y', weight: 1 }]);
    const open = buildGraph(many, [['pkg/x/f1.ts', 'pkg/y/f0.ts']], 'pkg/x');
    expect(open.nodes.filter((n) => n.kind === 'file')).toHaveLength(200);
    expect(open.edges).toEqual([{ source: 'pkg/x/f1.ts', target: 'pkg/y', weight: 1 }]);
  });

  it('colours by the first two folders, so a monorepo’s parts differ', () => {
    expect(topFolder('apps/api/src/x.ts')).toBe('apps/api');
    expect(topFolder('src/x.ts')).toBe('src');
    expect(topFolder('x.ts')).toBe('(root)');
  });

  it('lays out deterministically and fits the view around the nodes at the map’s aspect ratio', () => {
    const a = buildGraph(files, edges, null);
    const b = buildGraph(files, edges, null);
    layout(a.nodes, a.edges, { width: 1200, height: 800 });
    layout(b.nodes, b.edges, { width: 1200, height: 800 });
    expect(a.nodes.map((n) => [Math.round(n.x), Math.round(n.y)])).toEqual(b.nodes.map((n) => [Math.round(n.x), Math.round(n.y)]));
    const v = fit(a.nodes, { width: 1200, height: 800 });
    expect(v.w / v.h).toBeCloseTo(1.5);
    for (const n of a.nodes) expect(n.x > v.x && n.x < v.x + v.w && n.y > v.y && n.y < v.y + v.h).toBe(true);
  });
});
