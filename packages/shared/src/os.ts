/**
 * The operating system a checkpoint was made on, from the uploading client's user agent: the
 * appmarket CLI sends `appmarket-cli/<version> (<platform>; <arch>)` (Node's process.platform), and
 * browsers their usual string. Shown instead of the device's name.
 */
export function osFromUserAgent(ua: string | null | undefined): string | null {
	if (!ua) return null;
	const cli = /^appmarket-cli\/\S+ \(([a-z0-9]+)[;)]/.exec(ua);
	if (cli) return ({ darwin: "macOS", linux: "Linux", win32: "Windows", freebsd: "FreeBSD", openbsd: "OpenBSD" } as Record<string, string>)[cli[1]!] ?? null;
	if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
	if (/Android/.test(ua)) return "Android";
	if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
	if (/Windows/.test(ua)) return "Windows";
	if (/CrOS/.test(ua)) return "ChromeOS";
	if (/Linux/.test(ua)) return "Linux";
	return null;
}
