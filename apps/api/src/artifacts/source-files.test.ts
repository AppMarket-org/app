import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { ARTIFACTS: { get: mocks.get } } }));
const { sourceFiles } = await import('./git.ts');
const entry = (name: string, type: string, mode: string, hash = name) => ({ name, type, mode, hash });
const trees: Record<string, ReturnType<typeof entry>[]> = {
  root: [entry('src', 'tree', '40000'), entry('package.json', 'exec', '100755'), entry('README.md', 'blob', '100644'), entry('linked.md', 'symlink', '120000'), entry('dependency', 'gitlink', '160000'), entry('node_modules', 'tree', '40000')],
  src: [entry('main.ts', 'exec', '100755')],
  node_modules: [entry('tracked.js', 'blob', '100644')],
};
beforeEach(() => {
  mocks.get.mockResolvedValue({
    [Symbol.dispose]() {},
    readCommit: async () => ({ treeHash: 'root' }),
    readTree: async (hash: string) => trees[hash] ?? [],
  });
});
it('indexes regular, executable and symbolic-link files, including executables in nested directories', async () => {
  const result = await sourceFiles('repo', 'commit');
  expect(result.complete).toBe(true);
  expect(result.files.map(f => f.path)).toEqual(['linked.md', 'package.json', 'README.md', 'src/main.ts']);
  expect(result.files.find(f => f.path === 'package.json')?.mode).toBe('100755');
});
it('includes tracked dependencies when requested by file search', async () => {
  const result = await sourceFiles('repo', 'commit', { maxFiles: 5000, maxDirs: 2000, includeDependencies: true });
  expect(result.files.map(f => f.path)).toContain('node_modules/tracked.js');
  expect(result.files.map(f => f.path)).not.toContain('dependency');
});
