import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderCard, sectionOf } from '../../og.ts';

export const getStaticPaths = (async () =>
  (await getCollection('docs')).map((entry) => ({
    params: { slug: entry.id || 'index' },
    props: { title: entry.data.title, description: entry.data.description ?? '', section: entry.id === 'index' ? '' : sectionOf(entry.id) },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { title, description, section } = props as { title: string; description: string; section: string };
  const png = await renderCard({ title, subtitle: description, tags: ['Docs', section].filter(Boolean), brand: 'appmarket.org docs' });
  return new Response(png as BodyInit, { headers: { 'Content-Type': 'image/png' } });
};
