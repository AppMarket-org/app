import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { cardPath } from './og.ts';

/** Every page shares its own card (src/pages/og), with the page title as its alt text. */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const image = new URL(cardPath(route.entry.id), context.site).href;
  route.head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: route.entry.data.title } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  );
});
