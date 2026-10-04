import { exportScript } from './export-script';

describe('exportScript (#31)', () => {
  it('mirrors the repo, downloads each release into a safe path and checks its SHA-256', () => {
    const s = exportScript({
      repo: 'dev/app',
      gitRemote: 'https://example.test/git/dev/app.git',
      releases: [{ tag: 'v1.0.0', platform: 'android', filename: "../evil'name.apk", sizeBytes: 3, sha256: 'ab'.repeat(32), url: 'https://appmarket.test/api/downloads/r1?exp=1&sig=x&export=1' }],
      expiresAt: '2026-10-04T21:00:00Z',
    });
    expect(s).toContain("clone --mirror 'https://example.test/git/dev/app.git' repo.git");
    expect(s).toContain("curl -fsSL -o 'releases/v1.0.0/android/__evil_name.apk'");
    expect(s).toContain(`echo '${'ab'.repeat(32)}  releases/v1.0.0/android/__evil_name.apk' | shasum -a 256 -c -`);
    expect(s).not.toContain('../');
  });
});
