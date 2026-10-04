/**
 * #41: a minimal ustar writer for the eject archive (regular files only, gzip applied by the
 * caller with CompressionStream). Paths up to 255 bytes use the ustar prefix field.
 */
const encoder = new TextEncoder();

function field(buf: Uint8Array, offset: number, length: number, value: string): void {
	buf.set(encoder.encode(value).subarray(0, length), offset);
}

const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, "0")}\0`;

/**
 * A relative path that cannot leave the extraction folder: no absolute paths, empty, "." or ".."
 * segments, backslashes or control characters. Git refuses such names, but archives must not rely on
 * every pushed tree being valid.
 */
export function isSafeRelativePath(path: string): boolean {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	if (!path || path.startsWith("/") || /[\\\x00-\x1f]/.test(path)) return false;
	return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Splits a path into ustar name (≤100 bytes) and prefix (≤155 bytes), or null if it cannot fit. */
export function splitPath(path: string): { name: string; prefix: string } | null {
	if (encoder.encode(path).length <= 100) return { name: path, prefix: "" };
	for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
		const prefix = path.slice(0, i);
		const name = path.slice(i + 1);
		if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) return { name, prefix };
	}
	return null;
}

export function tarHeader(path: string, size: number, mtime: number, mode = 0o644): Uint8Array {
	if (!isSafeRelativePath(path)) throw new Error(`unsafe path for tar: ${JSON.stringify(path)}`);
	const split = splitPath(path);
	if (!split) throw new Error(`path too long for tar: ${path}`);
	const h = new Uint8Array(512);
	field(h, 0, 100, split.name);
	field(h, 100, 8, octal(mode, 8));
	field(h, 108, 8, octal(0, 8));
	field(h, 116, 8, octal(0, 8));
	field(h, 124, 12, octal(size, 12));
	field(h, 136, 12, octal(Math.floor(mtime / 1000), 12));
	field(h, 148, 8, "        ");
	field(h, 156, 1, "0");
	field(h, 257, 6, "ustar\0");
	field(h, 263, 2, "00");
	field(h, 345, 155, split.prefix);
	let sum = 0;
	for (const b of h) sum += b;
	field(h, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
	return h;
}

/** Header, contents and padding for one file. */
export function tarEntry(path: string, data: Uint8Array, mtime: number, mode = 0o644): Uint8Array[] {
	const pad = (512 - (data.length % 512)) % 512;
	return [tarHeader(path, data.length, mtime, mode), data, new Uint8Array(pad)];
}

/** Two zero blocks end the archive. */
export const tarEnd = () => new Uint8Array(1024);
