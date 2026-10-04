/**
 * Social preview cards (Open Graph, 1200×630). Pure: builds the Satori element tree, so the layout
 * is unit-tested without WebAssembly. Rendered to PNG by render.ts.
 */
export interface CardContent {
	/** Large title: the app name, or a page title for site cards. */
	title: string;
	subtitle: string;
	/** Small labels in the footer, e.g. owner/repo, category, runtime. */
	tags: string[];
}

export interface SatoriNode {
	type: string;
	props: { style?: Record<string, unknown>; children?: (SatoriNode | string)[] | SatoriNode | string; src?: string; width?: number; height?: number };
}

const el = (type: string, style: Record<string, unknown>, children?: SatoriNode["props"]["children"], extra: Partial<SatoriNode["props"]> = {}): SatoriNode => ({
	type,
	props: { style, ...(children === undefined ? {} : { children }), ...extra },
});

/** Cuts text to a length at a word boundary with an ellipsis (Satori's line clamping is limited). */
export function clip(text: string, max: number): string {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	const cut = t.slice(0, max - 1);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Colours from the site's Material azure palette. */
const BG = "#0b1d33";
const ACCENT = "#a8c8ff";
const TEXT = "#ffffff";
const MUTED = "#c4d2e6";

export function cardTree(content: CardContent, logoDataUrl: string): SatoriNode {
	const title = clip(content.title, 60);
	return el(
		"div",
		{ width: CARD_WIDTH, height: CARD_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: BG, color: TEXT, fontFamily: "Roboto" },
		[
			el("div", { display: "flex", alignItems: "center", gap: 20 }, [
				el("img", { width: 64, height: 56 }, undefined, { src: logoDataUrl, width: 64, height: 56 }),
				el("div", { fontSize: 34, fontWeight: 700, color: ACCENT }, "appmarket.org"),
			]),
			el("div", { display: "flex", flexDirection: "column", gap: 24 }, [
				el("div", { fontSize: title.length > 32 ? 64 : 80, fontWeight: 700, lineHeight: 1.1 }, title),
				el("div", { fontSize: 36, color: MUTED, lineHeight: 1.35 }, clip(content.subtitle, 150)),
			]),
			el(
				"div",
				{ display: "flex", flexWrap: "wrap", gap: 16 },
				content.tags.filter(Boolean).slice(0, 4).map((tag) => el("div", { fontSize: 26, color: ACCENT, border: `2px solid ${ACCENT}`, borderRadius: 999, padding: "8px 22px" }, clip(tag, 40))),
			),
		],
	);
}
