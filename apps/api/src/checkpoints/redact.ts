import { redactSecrets, type CheckpointRecord } from "@appmarket/shared";

/**
 * #128: the server's own pass over every text field of a record (prompts, the assistant's
 * message, tool arguments) with the shared pattern set. Returns the cleaned record and how many
 * secrets it replaced (also added to record.redactions).
 */
export function redactRecord<T extends CheckpointRecord>(record: T): { record: T; count: number } {
	let count = 0;
	const clean = (value: string) => {
		const r = redactSecrets(value);
		count += r.count;
		return r.text;
	};
	const next = {
		...record,
		prompts: record.prompts.map((p) => ({ ...p, text: clean(p.text) })),
		assistant_summary: clean(record.assistant_summary),
		tools: record.tools.map((t) => ({ ...t, args_summary: clean(t.args_summary) })),
	};
	if (count) next.redactions = record.redactions + count;
	return { record: count ? next : record, count };
}
