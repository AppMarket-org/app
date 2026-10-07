// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// docs.appmarket.org: a static Starlight site, deployed to Cloudflare (Workers static assets) by
// .github/workflows/docs.yml on every change under apps/docs.
export default defineConfig({
  site: 'https://docs.appmarket.org',
  integrations: [
    starlight({
      title: 'appmarket.org docs',
      description: 'Host repos, record the context behind every agent commit, and deploy apps into your own Cloudflare account.',
      logo: { src: './src/assets/logo.png', alt: 'appmarket.org' },
      favicon: '/favicon.png',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/AppMarket-org/app' }],
      editLink: { baseUrl: 'https://github.com/AppMarket-org/app/edit/main/apps/docs/' },
      lastUpdated: true,
      customCss: ['./src/styles/theme.css'],
      // The same fonts as appmarket.org (apps/web/src/index.html).
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap',
          },
        },
      ],
      sidebar: [
        { label: 'Start here', items: ['getting-started', 'concepts'] },
        { label: 'Git and code', items: ['git/repositories', 'git/pull-requests', 'git/issues'] },
        {
          label: 'Agents',
          items: ['agents/checkpoints', 'agents/adapters', 'agents/sessions', 'agents/collaboration', 'agents/a2a', 'agents/memory'],
        },
        { label: 'Apps', items: ['apps/publish', 'apps/deploy', 'apps/containers'] },
        { label: 'Mobile', items: ['mobile/android', 'mobile/ios', 'mobile/ci'] },
        { label: 'Reference', items: ['reference/cli', 'reference/device-login', 'reference/privacy'] },
      ],
    }),
  ],
});
