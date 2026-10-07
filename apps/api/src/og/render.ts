import { initWasm, Resvg } from "@resvg/resvg-wasm";
// Workers cannot compile WebAssembly from bytes at runtime, so both modules are imported.
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import satori, { init as initSatori } from "satori/standalone";
import yogaWasm from "satori/yoga.wasm";
import { cow, dmSans500, logo, manrope800 } from "./assets.generated.ts";
import { CARD_HEIGHT, CARD_WIDTH, type CardContent, cardTree } from "./card.ts";

let ready: Promise<void> | null = null;
// resvg refuses a second initWasm in the same isolate (e.g. after a failed first render); that is fine.
const initResvg = () => initWasm(resvgWasm).catch((error: unknown) => {
	if (!/Already initialized/.test(String(error))) throw error;
});
const setup = () => (ready ??= Promise.all([initSatori(yogaWasm), initResvg()]).then(() => undefined));

const bytes = (base64: string) => Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)).buffer;
let fonts: { body: ArrayBuffer; display: ArrayBuffer } | null = null;

/** A 1200×630 PNG social card. */
export async function renderCard(content: CardContent): Promise<Uint8Array> {
	await setup().catch((error) => {
		ready = null;
		throw error;
	});
	fonts ??= { body: bytes(dmSans500), display: bytes(manrope800) };
	const svg = await satori(cardTree(content, { logo: `data:image/png;base64,${logo}`, cow: `data:image/png;base64,${cow}` }) as never, {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		fonts: [
			{ name: "DM Sans", data: fonts.body, weight: 500, style: "normal" },
			{ name: "Manrope", data: fonts.display, weight: 800, style: "normal" },
		],
	});
	return new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng();
}
