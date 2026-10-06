import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Repo } from '@appmarket/shared';
import type { AuthVariables } from '../auth/middleware.ts';

vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
const mocks = vi.hoisted(() => ({ find: vi.fn(), files: vi.fn(), resolve: vi.fn(), refs: vi.fn() }));
vi.mock('./repository.ts', () => ({ RepoStore: class { findByPath = mocks.find; } }));
vi.mock('../artifacts/git.ts', () => ({ listRefs: mocks.refs, sourceFiles: mocks.files, resolveRef: mocks.resolve, listBranches: vi.fn(), readDirectory: vi.fn(), readPath: vi.fn() }));
const { codeRoutes } = await import('./code.ts');
let session: AuthVariables['session'] = null;
const repo = { gitRepo: 'git-repo', state: 'published', owner: { id: 'dev' }, publishedCommit: 'a'.repeat(40), publishedTag: 'v1' } as Repo;
const app = new Hono<{ Variables: AuthVariables }>().use('*', async (c, next) => { c.set('session', session); await next(); }).route('/', codeRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
  mocks.find.mockResolvedValue(repo);
  mocks.files.mockResolvedValue({ files: [{ path: 'src/index.ts' }, { path: 'README.md' }], complete: true });
});
it('indexes only the published commit for public readers, ignoring a requested private branch', async () => {
  const response = await app.request('/dev/app/code/files?ref=private');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ files: ['src/index.ts', 'README.md'], complete: true });
  expect(mocks.files).toHaveBeenCalledWith('git-repo', repo.publishedCommit, { maxFiles: 5000, maxDirs: 2000, includeDependencies: true });
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
});
it('hides an unpublished repository from another reader', async () => {
  mocks.find.mockResolvedValue({ ...repo, state: 'draft' });
  expect((await app.request('/dev/app/code/files')).status).toBe(404);
  expect(mocks.files).not.toHaveBeenCalled();
});
it('lets an owner index another branch without publicly caching its filenames', async () => {
  session = { user: { id: 'dev', role: 'developer' }, orgIds: [] } as unknown as AuthVariables['session'];
  mocks.resolve.mockResolvedValue('b'.repeat(40));
  mocks.files.mockResolvedValue({ files: Array.from({ length: 5001 }, (_, i) => ({ path: `${i}.ts` })), complete: false });
  const response = await app.request('/dev/app/code/files?ref=feature');
  const result = await response.json() as { files: string[]; complete: boolean };
  expect(result.files).toHaveLength(5000);
  expect(result.complete).toBe(false);
  expect(mocks.files).toHaveBeenCalledWith('git-repo', 'b'.repeat(40), { maxFiles: 5000, maxDirs: 2000, includeDependencies: true });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('returns real branch and tag names to an owner without exposing refs publicly', async () => {
  session = {user:{id:'dev', role:'developer'}, orgIds:[]} as unknown as AuthVariables['session'];
  mocks.refs.mockResolvedValue({defaultBranch:'main', refs:{'refs/heads/feature':'b'.repeat(40), 'refs/heads/main':'a'.repeat(40), 'refs/tags/v1':'a'.repeat(40), 'refs/tags/v2':'b'.repeat(40)}});
  const response = await app.request('/dev/app/code/branches');
  expect(await response.json()).toEqual({defaultBranch:'main', branches:['main','feature'], tags:['v1','v2']});
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  session = null;
  mocks.refs.mockClear();
  expect((await app.request('/dev/app/code/branches')).status).toBe(404);
  expect(mocks.refs).not.toHaveBeenCalled();
});

it('reports zero refs for an empty repository without counting the configured default branch', async () => {
  session = {user:{id:'dev', role:'developer'}, orgIds:[]} as unknown as AuthVariables['session'];
  mocks.refs.mockResolvedValue({defaultBranch:'main', refs:{}});
  expect(await (await app.request('/dev/app/code/branches')).json()).toEqual({defaultBranch:'main', branches:[], tags:[]});
});
