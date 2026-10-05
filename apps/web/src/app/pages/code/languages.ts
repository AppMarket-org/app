/** File name → Shiki language id; unknown files are shown as plain text. */
const BY_EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'jsonc', json5: 'json5', md: 'markdown', mdx: 'mdx', html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte', astro: 'astro', py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', sql: 'sql', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', svg: 'xml', graphql: 'graphql', gql: 'graphql', prisma: 'prisma', ini: 'ini', dart: 'dart', lua: 'lua',
};
const BY_NAME: Record<string, string> = { dockerfile: 'docker', makefile: 'make', '.gitignore': 'text', '.env.example': 'dotenv', '.dev.vars.example': 'dotenv' };

export function languageFor(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  return BY_NAME[name] ?? BY_EXT[name.includes('.') ? name.split('.').pop()! : ''] ?? 'text';
}
