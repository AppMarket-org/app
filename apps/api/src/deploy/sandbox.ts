import { CiSandbox as CiSandboxBase } from "@cloudflare/ci/worker";
import { env } from "cloudflare:workers";

/**
 * The build Sandbox. Locally, Docker Desktop exposes /dev/fuse, so the CI runner picks the
 * production backup path (presigned uploads to remote R2); in development, workspace snapshots go
 * to the local R2 binding instead.
 */
export class CiSandbox extends CiSandboxBase {
	override async createBackup(options: Parameters<CiSandboxBase["createBackup"]>[0]) {
		return super.createBackup(env.APP_ENV === "development" ? { ...options, localBucket: true } : options);
	}
}
