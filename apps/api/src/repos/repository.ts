import type {
	CategorySlug,
	Repo,
	RepoEvent,
	RepoInput,
	RepoPage,
	RepoSearch,
	RepoState,
	RepoUpdate,
	RepoVersion,
	Runtime,
	TargetPlatform,
	TransitionActor,
	TransitionRequest,
} from "@appmarket/shared";
import { slugify } from "@appmarket/shared";
import { buildSearchWhere } from "./search.ts";
import { transitionUpdate } from "./transition-sql.ts";

export type RepoCheckSummary = NonNullable<Repo["submittedChecks"]>;

interface RepoRow {
	id: string;
	slug: string;
	name: string;
	summary: string;
	description: string;
	category: CategorySlug;
	runtime: Runtime;
	platforms: string;
	license: string | null;
	submitted_notes: string | null;
	price_cents: number;
	state: RepoState;
	owner_id: string;
	owner_name: string;
	git_repo: string | null;
	submitted_tag: string | null;
	submitted_commit: string | null;
	published_tag: string | null;
	published_commit: string | null;
	submitted_checks: string | null;
	published_manifest: string | null;
	created_at: string;
	updated_at: string;
}

const SELECT = `SELECT l.*, u.name AS owner_name FROM repos l JOIN "user" u ON u.id = l.owner_id`;

function toRepo(row: RepoRow): Repo {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		summary: row.summary,
		description: row.description,
		category: row.category,
		runtime: row.runtime,
		platforms: JSON.parse(row.platforms) as TargetPlatform[],
		license: row.license,
		priceCents: row.price_cents,
		state: row.state,
		owner: { id: row.owner_id, name: row.owner_name },
		gitRepo: row.git_repo,
		submittedTag: row.submitted_tag,
		submittedCommit: row.submitted_commit,
		publishedTag: row.published_tag,
		publishedCommit: row.published_commit,
		submittedChecks: row.submitted_checks ? JSON.parse(row.submitted_checks) : null,
		manifest: row.published_manifest ? JSON.parse(row.published_manifest) : null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** D1 access for repos (PRD R1). */
export class RepoStore {
	constructor(private readonly db: D1Database) {}

	async search(search: RepoSearch): Promise<RepoPage> {
		const { where, params } = buildSearchWhere(search);
		const offset = (search.page - 1) * search.pageSize;
		const [rows, count] = await this.db.batch([
			this.db.prepare(`${SELECT} WHERE ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`).bind(...params, search.pageSize, offset),
			this.db.prepare(`SELECT COUNT(*) AS total FROM repos l WHERE ${where}`).bind(...params),
		]);
		return {
			items: (rows.results as unknown as RepoRow[]).map(toRepo),
			page: search.page,
			pageSize: search.pageSize,
			total: (count.results[0] as { total: number }).total,
		};
	}

	async findBySlug(slug: string): Promise<Repo | null> {
		const row = await this.db.prepare(`${SELECT} WHERE l.slug = ?`).bind(slug).first<RepoRow>();
		return row ? toRepo(row) : null;
	}

	async findById(id: string): Promise<Repo | null> {
		const row = await this.db.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<RepoRow>();
		return row ? toRepo(row) : null;
	}

	async listByOwner(ownerId: string): Promise<Repo[]> {
		const { results } = await this.db
			.prepare(`${SELECT} WHERE l.owner_id = ? AND l.state != 'removed' ORDER BY l.updated_at DESC`)
			.bind(ownerId)
			.all<RepoRow>();
		return results.map(toRepo);
	}

	/** A new repo id and a slug not yet used, derived from the name. */
	async reserve(name: string): Promise<{ id: string; slug: string }> {
		return { id: crypto.randomUUID(), slug: await this.uniqueSlug(slugify(name)) };
	}

	/** Inserts a draft. Fails on a slug or repo name collision (UNIQUE constraints). */
	async insert(ids: { id: string; slug: string }, ownerId: string, input: RepoInput, gitRepo: string): Promise<Repo> {
		await this.db
			.prepare(
				"INSERT INTO repos (id, owner_id, slug, name, summary, description, category, runtime, platforms, license, git_repo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(ids.id, ownerId, ids.slug, input.name, input.summary, input.description, input.category, input.runtime, JSON.stringify(input.platforms), input.license, gitRepo)
			.run();
		return (await this.findBySlug(ids.slug))!;
	}

	/** Updates editable fields. The slug stays fixed so published URLs never break. */
	async update(id: string, update: RepoUpdate): Promise<void> {
		const columns = {
			name: update.name,
			summary: update.summary,
			description: update.description,
			category: update.category,
			runtime: update.runtime,
			platforms: update.platforms && JSON.stringify(update.platforms),
			license: update.license,
		};
		const set = Object.entries(columns).filter(([, value]) => value !== undefined);
		if (set.length === 0) return;
		await this.db
			.prepare(`UPDATE repos SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
			.bind(...set.map(([, value]) => value), id)
			.run();
	}

	/** Repos an owner has that are not removed (R19 quota). */
	async countActiveByOwner(ownerId: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM repos WHERE owner_id = ? AND state != 'removed'").bind(ownerId).first<{ n: number }>();
		return row?.n ?? 0;
	}

	/** Repos in one state, oldest first (moderation queue, R18). */
	async listByState(state: RepoState): Promise<Repo[]> {
		const { results } = await this.db.prepare(`${SELECT} WHERE l.state = ? ORDER BY l.updated_at ASC`).bind(state).all<RepoRow>();
		return results.map(toRepo);
	}

	/**
	 * Applies a lifecycle transition and records it, atomically. The update only matches while the
	 * repo is still in `from`, so a concurrent transition makes this return false instead of
	 * overwriting it.
	 */
	async transition(
		repo: Repo,
		request: TransitionRequest,
		actor: { id: string; role: TransitionActor },
		/** For a submit: the commit the tag resolves to now. */
		submittedCommit: string | null = null,
		/** For a submit: D2/G4 warnings and D3 manifest. */
		submittedChecks: RepoCheckSummary | null = null,
	): Promise<boolean> {
		const [tag, commit] =
			request.to === "submitted" ? [request.tag, submittedCommit] : request.to === "published" ? [repo.submittedTag, repo.submittedCommit] : [null, null];
		const note = "note" in request ? (request.note ?? null) : null;
		const submittedNotes = request.to === "published" ? await this.submittedNotes(repo.id) : null;
		const [update] = await this.db.batch([
			(({ sql, params }) => this.db.prepare(sql).bind(...params))(transitionUpdate(repo, request, actor.id, submittedCommit, submittedChecks && JSON.stringify(submittedChecks))),
			this.db
				.prepare(
					"INSERT INTO repo_events (repo_id, from_state, to_state, actor_id, actor_role, tag, commit_hash, note) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0",
				)
				.bind(repo.id, repo.state, request.to, actor.id, actor.role, tag, commit, note),
			// R24: publishing adds the reviewed version to the changelog.
			...(request.to === "published"
				? [
						this.db
							.prepare(
								"INSERT INTO repo_versions (repo_id, tag, commit_hash, release_notes, published_by) SELECT ?, ?, ?, ?, ? WHERE changes() > 0",
							)
							.bind(repo.id, repo.submittedTag, repo.submittedCommit, submittedNotes ?? "", actor.id),
					]
				: []),
		]);
		return update.meta.changes > 0;
	}

	async events(repoId: string): Promise<RepoEvent[]> {
		const { results } = await this.db
			.prepare(
				`SELECT e.*, u.name AS actor_name FROM repo_events e JOIN "user" u ON u.id = e.actor_id WHERE e.repo_id = ? ORDER BY e.id DESC`,
			)
			.bind(repoId)
			.all<{
				from_state: RepoState;
				to_state: RepoState;
				actor_id: string;
				actor_name: string;
				actor_role: TransitionActor;
				tag: string | null;
				commit_hash: string | null;
				note: string | null;
				created_at: string;
			}>();
		return results.map((r) => ({
			from: r.from_state,
			to: r.to_state,
			actor: { id: r.actor_id, name: r.actor_name, role: r.actor_role },
			tag: r.tag,
			commit: r.commit_hash,
			note: r.note,
			createdAt: r.created_at,
		}));
	}

	private async submittedNotes(repoId: string): Promise<string | null> {
		return (await this.db.prepare("SELECT submitted_notes FROM repos WHERE id = ?").bind(repoId).first<{ submitted_notes: string | null }>())?.submitted_notes ?? null;
	}

	/** PRD R24: published versions, newest first (the changelog). */
	async versions(repoId: string): Promise<RepoVersion[]> {
		const { results } = await this.db
			.prepare("SELECT tag, commit_hash, release_notes, published_at FROM repo_versions WHERE repo_id = ? ORDER BY id DESC LIMIT 100")
			.bind(repoId)
			.all<{ tag: string; commit_hash: string; release_notes: string; published_at: string }>();
		return results.map((r) => ({ tag: r.tag, commit: r.commit_hash, releaseNotes: r.release_notes, publishedAt: r.published_at }));
	}

	private async uniqueSlug(base: string): Promise<string> {
		const { results } = await this.db
			.prepare("SELECT slug FROM repos WHERE slug = ? OR slug LIKE ?")
			.bind(base, `${base}-%`)
			.all<{ slug: string }>();
		const taken = new Set(results.map((r) => r.slug));
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) {
			if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
		}
	}
}
