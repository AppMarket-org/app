import type { ListingSearch } from "@appmarket/shared";

/** Escapes LIKE wildcards so user input matches literally (used with ESCAPE '\'). */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** WHERE clause and bindings for public catalog search: published listings only. */
export function buildSearchWhere(search: Pick<ListingSearch, "q" | "category" | "runtime">): { where: string; params: unknown[] } {
	const clauses = ["l.state = 'published'"];
	const params: unknown[] = [];
	if (search.q) {
		const pattern = `%${escapeLike(search.q)}%`;
		clauses.push("(l.name LIKE ? ESCAPE '\\' OR l.summary LIKE ? ESCAPE '\\')");
		params.push(pattern, pattern);
	}
	if (search.category) {
		clauses.push("l.category = ?");
		params.push(search.category);
	}
	if (search.runtime) {
		clauses.push("l.runtime = ?");
		params.push(search.runtime);
	}
	return { where: clauses.join(" AND "), params };
}
