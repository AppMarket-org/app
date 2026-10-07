/** A repo A2A key, as its owners see it (the key itself is shown once, at creation). */
export interface A2AKey {
	id: string;
	name: string;
	/** The key's first characters, to tell keys apart. */
	prefix: string;
	createdBy: string;
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
}

/** A2A keys expire after one of these numbers of days. */
export const A2A_KEY_DAYS = [30, 90, 365] as const;
export const A2A_KEY_PREFIX = "ama2a_";
