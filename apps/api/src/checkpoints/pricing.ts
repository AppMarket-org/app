import { PRICE_TABLE_VERSION, costUsd, type CheckpointRecord } from "@appmarket/shared";

/** #127: harnesses rarely report cost; fill it from the model price table, noting the table version. */
export function priceRecord<T extends CheckpointRecord>(record: T): T {
	if (record.usage.cost_usd !== null) return record;
	const cost = costUsd(record.model, record.usage);
	return cost === null ? record : { ...record, usage: { ...record.usage, cost_usd: cost, cost_priced: PRICE_TABLE_VERSION } };
}
