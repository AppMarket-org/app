import type { RepoExport } from '@appmarket/shared';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Path segments from tags and file names, without anything that could leave the export folder. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_');

/**
 * #31: a POSIX shell script that mirrors the Git repository (with a read token from
 * APPMARKET_GIT_TOKEN) and downloads every release file, checking each SHA-256.
 */
export function exportScript(exp: RepoExport): string {
  const dir = exp.repo.replace('/', '-');
  const lines = [
    '#!/bin/sh',
    `# appmarket.org export of ${exp.repo}. The download links work until ${exp.expiresAt}.`,
    '# Set APPMARKET_GIT_TOKEN to a read token from the repo page first.',
    'set -eu',
    `mkdir -p ${q(dir)} && cd ${q(dir)}`,
  ];
  if (exp.gitRemote) lines.push(`git -c http.extraHeader="Authorization: Bearer $APPMARKET_GIT_TOKEN" clone --mirror ${q(exp.gitRemote)} repo.git`);
  for (const r of exp.releases) {
    const path = `releases/${safe(r.tag)}/${r.platform}/${safe(r.filename)}`;
    lines.push(`mkdir -p ${q(path.slice(0, path.lastIndexOf('/')))}`, `curl -fsSL -o ${q(path)} ${q(r.url)}`, `echo ${q(`${r.sha256}  ${path}`)} | shasum -a 256 -c -`);
  }
  lines.push(`echo "Exported ${exp.repo}: ${exp.gitRemote ? 'Git mirror in repo.git, ' : ''}${exp.releases.length} release file(s) in releases/."`);
  return lines.join('\n') + '\n';
}
