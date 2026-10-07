/**
 * Social preview cards (Open Graph, 1200×630). Pure: builds the Satori element tree, so the layout
 * is unit-tested without WebAssembly. Rendered to PNG by render.ts.
 */
export interface CardContent {
	/** Large title: the app name, or a page title for site cards. */
	title: string;
	/** A second title line in the accent colour (the site card's tagline). */
	highlight?: string;
	subtitle: string;
	/** Small labels in the footer, e.g. owner/repo, category, runtime. */
	tags: string[];
	/** The name beside the logo; appmarket.org unless set (the docs site's cards). */
	brand?: string;
}

export interface CardImages {
	logo: string;
	/** The mascot, a transparent PNG. */
	cow: string;
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

/** Brand tokens from apps/web/src/material-theme.scss. */
const INK = "#20251f";
const PAPER = "#f8f7f4";
const COPPER = "#f4b894";
const MUTED = "#c9c8bf";

export function cardTree(content: CardContent, images: CardImages): SatoriNode {
	const title = clip(content.title, 60);
	const site = Boolean(content.highlight);
	const cow = site ? 500 : 380;
	const tags = content.tags.filter(Boolean).slice(0, 4);
	return el(
		"div",
		{
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			display: "flex",
			position: "relative",
			background: INK,
			backgroundImage: `radial-gradient(circle at 88% 62%, #6b3a22 0%, ${INK} 46%)`,
			color: PAPER,
			fontFamily: "DM Sans",
		},
		[
			el("img", { position: "absolute", right: site ? 36 : 40, bottom: site ? 24 : 40, width: cow, height: cow * (560 / 547) }, undefined, { src: images.cow, width: cow, height: Math.round(cow * (560 / 547)) }),
			el("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", width: site ? 700 : 760, height: CARD_HEIGHT, padding: "60px 0 60px 72px" }, [
				el("div", { display: "flex", alignItems: "center", gap: 18 }, [
					el("img", { width: 56, height: 49 }, undefined, { src: images.logo, width: 56, height: 49 }),
					el("div", { fontFamily: "Manrope", fontSize: 32, fontWeight: 800, color: PAPER }, content.brand ?? "appmarket.org"),
				]),
				el("div", { display: "flex", flexDirection: "column", gap: 22 }, [
					el("div", { display: "flex", flexDirection: "column", fontFamily: "Manrope", fontWeight: 800, fontSize: site ? 70 : title.length > 28 ? 60 : 76, lineHeight: 1.05, letterSpacing: -1.5 }, [
						el("div", {}, title),
						...(content.highlight ? [el("div", { color: COPPER }, content.highlight)] : []),
					]),
					el("div", { fontSize: 29, color: MUTED, lineHeight: 1.35 }, clip(content.subtitle, site ? 120 : 140)),
				]),
				el(
					"div",
					{ display: "flex", flexWrap: "wrap", gap: 14 },
					tags.map((tag) => el("div", { fontSize: 24, color: COPPER, border: `2px solid ${COPPER}`, borderRadius: 999, padding: "6px 20px" }, clip(tag, 40))),
				),
			]),
		],
	);
}
