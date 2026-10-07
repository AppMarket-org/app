// Social preview cards for the docs, rendered at build time with the same design as appmarket.org's
// (apps/api/src/og/card.ts) and the same fonts and images.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import satori from 'satori';
import { CARD_HEIGHT, CARD_WIDTH, type CardContent, cardTree } from '../../api/src/og/card.ts';

// Builds run in apps/docs; import.meta.url points into the bundle there, so paths start from it.
const asset = (file: string) => readFileSync(resolve(process.cwd(), '../api/src/og/assets', file));
const dataUrl = (file: string) => `data:image/png;base64,${asset(file).toString('base64')}`;

let ready: Promise<void> | null = null;
const setup = () => (ready ??= initWasm(readFileSync(createRequire(resolve(process.cwd(), 'package.json')).resolve('@resvg/resvg-wasm/index_bg.wasm'))));

export async function renderCard(content: CardContent): Promise<Uint8Array> {
  await setup();
  const svg = await satori(cardTree(content, { logo: dataUrl('logo.png'), cow: dataUrl('cow.png') }) as never, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      { name: 'DM Sans', data: asset('dmsans-500.ttf'), weight: 500, style: 'normal' },
      { name: 'Manrope', data: asset('manrope-800.ttf'), weight: 800, style: 'normal' },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();
}

/** The sidebar group a page is in, from its path. */
const SECTIONS: Record<string, string> = { git: 'Git and code', agents: 'Agents', apps: 'Apps', mobile: 'Mobile', reference: 'Reference' };
export const sectionOf = (id: string) => SECTIONS[id.split('/')[0]!] ?? 'Start here';

/** Where a page's card is served: /og/<page id>.png. */
export const cardPath = (id: string) => `/og/${id || 'index'}.png`;
