/**
 * #260: messages to the person pushing ("remote: …" lines), added to git-receive-pack's response.
 * Git shows side-band channel 2 as remote messages; the response ends with a flush packet, and the
 * report-status (on channel 1) says which refs were updated. Pure, for tests.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function packets(bytes: Uint8Array): { data: Uint8Array | null; end: number }[] {
	const out: { data: Uint8Array | null; end: number }[] = [];
	let i = 0;
	while (i + 4 <= bytes.length) {
		const len = Number.parseInt(dec.decode(bytes.subarray(i, i + 4)), 16);
		if (Number.isNaN(len)) break;
		if (len === 0) {
			out.push({ data: null, end: i + 4 });
			i += 4;
			continue;
		}
		if (len < 4 || i + len > bytes.length) break;
		out.push({ data: bytes.subarray(i + 4, i + len), end: i + len });
		i += len;
	}
	return out;
}

/** Refs the push updated ("ok refs/heads/x" in the report-status), when side-band is in use. */
export function updatedRefs(response: Uint8Array): string[] {
	const outer = packets(response);
	const sideband = outer.some((p) => p.data && p.data.length > 0 && p.data[0]! <= 3);
	const report: Uint8Array[] = sideband ? outer.filter((p) => p.data?.[0] === 1).map((p) => p.data!.subarray(1)) : [];
	const joined = new Uint8Array(report.reduce((n, r) => n + r.length, 0));
	let o = 0;
	for (const r of report) {
		joined.set(r, o);
		o += r.length;
	}
	return packets(joined)
		.map((p) => (p.data ? dec.decode(p.data).trim() : ""))
		.filter((l) => l.startsWith("ok "))
		.map((l) => l.slice(3));
}

/** Adds side-band channel 2 messages before the final flush; returns the response unchanged if it is not side-band. */
export function withMessages(response: Uint8Array, lines: string[]): Uint8Array {
	if (!lines.length) return response;
	const outer = packets(response);
	const last = outer.at(-1);
	if (!last || last.data !== null || last.end !== response.length || !outer.some((p) => p.data?.[0] === 1)) return response;
	const flushAt = response.length - 4;
	const messages = lines.map((line) => {
		const body = enc.encode(`${line}\n`);
		const pkt = new Uint8Array(5 + body.length);
		pkt.set(enc.encode((5 + body.length).toString(16).padStart(4, "0")), 0);
		pkt[4] = 2;
		pkt.set(body, 5);
		return pkt;
	});
	const out = new Uint8Array(response.length + messages.reduce((n, m) => n + m.length, 0));
	out.set(response.subarray(0, flushAt), 0);
	let o = flushAt;
	for (const m of messages) {
		out.set(m, o);
		o += m.length;
	}
	out.set(response.subarray(flushAt), o);
	return out;
}
