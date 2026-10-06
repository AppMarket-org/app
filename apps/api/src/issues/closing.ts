/** "Fixes #3", "closes #4 and resolves #5": the issue numbers a pull request's text closes. */
export function closingNumbers(text: string): number[] {
	const out = new Set<number>();
	for (const m of text.matchAll(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+#(\d{1,7})\b/gi)) out.add(Number(m[1]));
	return [...out];
}
