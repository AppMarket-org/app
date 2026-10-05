/** The default branch if it exists, else main, master, then the others by name. */
export function pickBranch(defaultBranch: string, branches: { name: string; sha: string }[]): { name: string; sha: string } | null {
	const order = [defaultBranch, "main", "master"];
	const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
	return [...branches].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))[0] ?? null;
}
