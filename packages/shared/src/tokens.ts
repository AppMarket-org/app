import { z } from "zod";

/** PRD R3: repo-scoped Artifacts tokens. Read for clone/fetch, write for push. Lifetimes in seconds. */
export const TOKEN_TTL = {
	default: 3600,
	min: 60,
	max: { read: 86_400, write: 28_800 },
} as const;

export const tokenRequestSchema = z
	.object({
		scope: z.enum(["read", "write"]),
		ttl: z.coerce.number().int().min(TOKEN_TTL.min).optional(),
	})
	.refine((r) => r.ttl === undefined || r.ttl <= TOKEN_TTL.max[r.scope], {
		path: ["ttl"],
		message: `At most ${TOKEN_TTL.max.read}s for read and ${TOKEN_TTL.max.write}s for write`,
	});
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

/** Returned once; never stored or logged by appmarket.org. */
export interface RepoToken {
	scope: "read" | "write";
	remote: string;
	token: string;
	expiresAt: string;
}
