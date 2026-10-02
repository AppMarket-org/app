/** PRD R18: reasons a visitor can report a listing. */
export const REPORT_REASONS = {
	malware: "Malware or security risk",
	copyright: "Copyright or trademark (DMCA)",
	illegal: "Illegal content",
	spam: "Spam or misleading",
	other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export interface ListingReport {
	id: string;
	listing: { slug: string; name: string; state: string };
	reason: ReportReason;
	details: string;
	contact: string | null;
	createdAt: string;
	resolvedAt: string | null;
	resolution: string | null;
}
