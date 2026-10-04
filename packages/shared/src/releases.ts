/** PRD R13: platforms a release binary targets. */
export const RELEASE_PLATFORMS = {
	android: "Android",
	ios: "iOS",
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
	web: "Web bundle",
	other: "Other",
} as const;
export type ReleasePlatform = keyof typeof RELEASE_PLATFORMS;

export const RELEASE_LIMITS = {
	/** Uploads pass through a Worker; Cloudflare caps request bodies at 100 MB on Free and Pro zones. */
	maxBytes: 100_000_000,
	maxPerVersion: 20,
} as const;

/** A release binary stored in R2 (PRD R5, R13). */
export interface Release {
	id: string;
	tag: string;
	platform: ReleasePlatform;
	filename: string;
	sizeBytes: number;
	/** Hex SHA-256 of the file, verified by R2 on upload. */
	sha256: string;
	downloads: number;
	createdAt: string;
}

/** #31 (R25): everything needed to take a repo elsewhere. Links are signed and expire in an hour. */
export interface RepoExport {
	repo: string;
	gitRemote: string | null;
	releases: { tag: string; platform: ReleasePlatform; filename: string; sizeBytes: number; sha256: string; url: string }[];
	expiresAt: string;
}

/** PRD R14: a short-lived signed link for one release. */
export interface DownloadLink {
	url: string;
	expiresAt: string;
}
