/**
 * #28: Artifacts has no API to list branches, so they come from Git's own HTTP ref advertisement
 * (`info/refs?service=git-upload-pack`, protocol v1). Pure parsing here, so it is unit-tested.
 */
export function parseBranches(advertisement: string): { name: string; sha: string }[] {
	const branches: { name: string; sha: string }[] = [];
	// Each pkt-line is a 4-hex-digit length then the payload; "0000" flushes.
	let i = 0;
	while (i + 4 <= advertisement.length) {
		const length = Number.parseInt(advertisement.slice(i, i + 4), 16);
		if (Number.isNaN(length)) break;
		if (length === 0) {
			i += 4;
			continue;
		}
		const line = advertisement.slice(i + 4, i + length).replace(/\n$/, "").split("\0")[0]!;
		i += length;
		const match = /^([0-9a-f]{40}) refs\/heads\/(.+)$/.exec(line);
		if (match) branches.push({ sha: match[1]!, name: match[2]! });
	}
	return branches;
}

/**
 * #34: every branch and tag with the commit it points to. Annotated tags are peeled to their
 * commit (the advertisement lists `refs/tags/x^{}` after the tag object).
 */
export function parseRefs(advertisement: string): Record<string, string> {
	const refs: Record<string, string> = {};
	let i = 0;
	while (i + 4 <= advertisement.length) {
		const length = Number.parseInt(advertisement.slice(i, i + 4), 16);
		if (Number.isNaN(length)) break;
		if (length === 0) {
			i += 4;
			continue;
		}
		const line = advertisement.slice(i + 4, i + length).replace(/\n$/, "").split("\0")[0]!;
		i += length;
		const match = /^([0-9a-f]{40}) (refs\/(?:heads|tags)\/.+?)(\^\{\})?$/.exec(line);
		if (match) refs[match[2]!] = match[1]!;
	}
	return refs;
}
