/** #133: the network a request came from, without the host part: a.b.c.0/24 or x:y:z::/48. */
export function ipPrefix(ip: string | null | undefined): string | null {
	if (!ip) return null;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
	if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
	if (ip.includes(":")) {
		const [head] = ip.trim().split("::");
		const groups = (head ?? "").split(":").filter(Boolean);
		while (groups.length < 3) groups.push("0");
		return `${groups.slice(0, 3).join(":").toLowerCase()}::/48`;
	}
	return null;
}
