import type { CheckpointRecord } from "@appmarket/shared";

/** The API's inline limit is 256 KB; keep a margin for the request. */
const INLINE_BYTES = 250 * 1024;
const TRANSCRIPT_BYTES = 10 * 1024 * 1024;
const size = (r: CheckpointRecord) => Buffer.byteLength(JSON.stringify(r));

/**
 * #129: a record that fits inline is sent as is. A larger one is sent trimmed (most recent
 * prompts, last tools, first files, marked truncated) with the full record as its transcript,
 * which appmarket.org stores encrypted. A transcript over 10 MB keeps the newest prompts.
 */
export function fitRecord(full: CheckpointRecord): { record: CheckpointRecord; transcript?: CheckpointRecord } {
	if (size(full) <= INLINE_BYTES) return { record: full };
	let transcript = full;
	while (size(transcript) > TRANSCRIPT_BYTES && transcript.prompts.length > 1) transcript = { ...transcript, prompts: transcript.prompts.slice(Math.ceil(transcript.prompts.length / 4)), truncated: true };
	let keep = { prompts: 20, chars: 4000, tools: 50, files: 300 };
	for (;;) {
		const record: CheckpointRecord = {
			...full,
			prompts: full.prompts.slice(-keep.prompts).map((p) => (p.text.length > keep.chars ? { ...p, text: `${p.text.slice(0, keep.chars - 1)}…` } : p)),
			tools: full.tools.slice(-keep.tools),
			files: full.files.slice(0, keep.files),
			truncated: true,
		};
		if (size(record) <= INLINE_BYTES || keep.prompts === 1) return { record, transcript };
		keep = { prompts: Math.max(1, Math.floor(keep.prompts / 2)), chars: Math.max(500, Math.floor(keep.chars / 2)), tools: Math.floor(keep.tools / 2), files: Math.floor(keep.files / 2) };
	}
}
