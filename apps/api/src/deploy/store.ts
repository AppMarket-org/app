import type { Deployment, DeploymentStatus } from "@appmarket/shared";
import type { DeployConfig } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { decryptToken, encryptToken } from "../cloudflare/crypto.ts";
import type { DeployPlan } from "./commands.ts";

/** Additional data for a deployment's sealed secrets: they only decrypt for this row and user. */
const secretsAad = (id: string, userId: string) => `deployment:${id}:${userId}`;

export interface NewDeployment {
	id: string;
	userId: string;
	listingId: string;
	versionTag: string;
	commitSha: string;
	accountId: string;
	workerName: string;
	deploy: DeployConfig;
	secrets: Record<string, string>;
}

export async function insertDeployment(d: NewDeployment): Promise<void> {
	const sealed = Object.keys(d.secrets).length ? await encryptToken(env.CF_TOKEN_ENCRYPTION_KEY, JSON.stringify(d.secrets), secretsAad(d.id, d.userId)) : null;
	await env.DB.prepare(
		`INSERT INTO deployments (id, user_id, listing_id, version_tag, commit_sha, account_id, worker_name, deploy_config, secrets_enc)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(d.id, d.userId, d.listingId, d.versionTag, d.commitSha, d.accountId, d.workerName, JSON.stringify(d.deploy), sealed)
		.run();
}

/**
 * What the Workflow needs to build and deploy. Contains no secret values (it is persisted as a step
 * output); the plan stays a JSON string so the step result is serializable.
 */
export async function loadDeployment(id: string): Promise<{ userId: string; accountId: string; plan: string }> {
	const row = await env.DB.prepare("SELECT user_id, account_id, worker_name, deploy_config FROM deployments WHERE id = ?")
		.bind(id)
		.first<{ user_id: string; account_id: string; worker_name: string; deploy_config: string }>();
	if (!row) throw new Error(`Deployment ${id} not found`);
	const deploy = JSON.parse(row.deploy_config) as DeployConfig;
	const plan: DeployPlan = { workerName: row.worker_name, ...deploy };
	return { userId: row.user_id, accountId: row.account_id, plan: JSON.stringify(plan) };
}

export async function readDeploymentSecrets(id: string, userId: string): Promise<Record<string, string>> {
	const row = await env.DB.prepare("SELECT secrets_enc FROM deployments WHERE id = ?").bind(id).first<{ secrets_enc: string | null }>();
	if (!row?.secrets_enc) return {};
	return JSON.parse(await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, row.secrets_enc, secretsAad(id, userId))) as Record<string, string>;
}

export async function setDeploymentStatus(id: string, status: DeploymentStatus): Promise<void> {
	await env.DB.prepare("UPDATE deployments SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(status, id).run();
}

/** Final status. Secret values are deleted either way; they now live only in the buyer's Worker. */
export async function finishDeployment(id: string, status: "succeeded" | "failed", result: { url?: string | null; error?: string }): Promise<void> {
	await env.DB.prepare(
		"UPDATE deployments SET status = ?, url = ?, error = ?, secrets_enc = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
	)
		.bind(status, result.url ?? null, result.error ?? null, id)
		.run();
}

interface DeploymentRow {
	id: string;
	slug: string;
	name: string;
	version_tag: string;
	account_id: string;
	worker_name: string;
	status: DeploymentStatus;
	url: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
}

const SELECT = `SELECT d.id, l.slug, l.name, d.version_tag, d.account_id, d.worker_name, d.status, d.url, d.error, d.created_at, d.updated_at
	FROM deployments d JOIN listings l ON l.id = d.listing_id`;

const toDeployment = (r: DeploymentRow): Deployment => ({
	id: r.id,
	listingSlug: r.slug,
	listingName: r.name,
	versionTag: r.version_tag,
	accountId: r.account_id,
	workerName: r.worker_name,
	status: r.status,
	url: r.url,
	error: r.error,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
});

export async function deploymentFor(userId: string, id: string): Promise<Deployment | null> {
	const row = await env.DB.prepare(`${SELECT} WHERE d.id = ? AND d.user_id = ?`).bind(id, userId).first<DeploymentRow>();
	return row ? toDeployment(row) : null;
}

export async function deploymentsFor(userId: string): Promise<Deployment[]> {
	const { results } = await env.DB.prepare(`${SELECT} WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT 50`).bind(userId).all<DeploymentRow>();
	return results.map(toDeployment);
}
