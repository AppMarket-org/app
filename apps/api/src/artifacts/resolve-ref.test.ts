import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn(), revoke: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { ARTIFACTS: { get: mocks.get } } }));
const { resolveRef } = await import('./git.ts');
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('distinguishes a qualified tag from a same-named branch and peels annotated tags', async () => {
  const branch = 'a'.repeat(40), tag = 'b'.repeat(40);
  const packet = (line: string) => (line.length + 4).toString(16).padStart(4, '0') + line;
  const advertisement = packet(`${branch} refs/heads/v1\n`) + packet(`${'c'.repeat(40)} refs/tags/v1\n`) + packet(`${tag} refs/tags/v1^{}\n`) + '0000';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(advertisement)));
  mocks.get.mockResolvedValue({
    [Symbol.dispose]() {},
    info: async () => ({ remote: 'https://git.example.test/repo', defaultBranch: 'main' }),
    createToken: async () => ({ id: 'read-token', plaintext: 'test-token' }),
    revokeToken: mocks.revoke.mockResolvedValue(true),
    log: mocks.log,
  });
  expect(await resolveRef('repo', 'refs/tags/v1')).toBe(tag);
  expect(await resolveRef('repo', 'refs/heads/v1')).toBe(branch);
  expect(await resolveRef('repo', 'refs/tags/missing')).toBeNull();
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.revoke).toHaveBeenCalledTimes(3);
});
