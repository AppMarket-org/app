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
import { avatarUrl, slugify, type CheckpointVisibility, type OwnerKind } from "@appmarket/shared";
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
	owner_handle: string;
	owner_kind: OwnerKind;
	owner_avatar_id: string | null;
	published_languages: string | null;
	forked_from_path: string | null;
	session_of: string | null;
	imported_from: string | null;
	forked_tag: string | null;
	forked_commit: string | null;
	owner_image: string | null;
	git_repo: string | null;
	submitted_tag: string | null;
	submitted_commit: string | null;
	published_tag: string | null;
	published_commit: string | null;
	submitted_checks: string | null;
	published_manifest: string | null;
	published_pwa: string | null;
	demo_url: string | null;
	android_package: string | null;
	android_verified_at: string | null;
	cowbell_count: number;
	checkpoint_visibility: CheckpointVisibility;
	created_at: string;
	updated_at: string;
}

// The owner is a user or an organization (#102); users show their profile name.
const SELECT = `SELECT l.*, (SELECT fo.handle || '/' || f.slug FROM repos f JOIN owners fo ON fo.id = f.owner_id WHERE f.id = l.forked_from) AS forked_from_path, o.handle AS owner_handle, o.kind AS owner_kind, COALESCE(o.name, u.name, o.handle) AS owner_name, o.avatar_id AS owner_avatar_id, u.image AS owner_image
	FROM repos l JOIN owners o ON o.id = l.owner_id LEFT JOIN "user" u ON u.id = o.user_id`;

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
		owner: { id: row.owner_id, handle: row.owner_handle, kind: row.owner_kind, name: row.owner_name, avatarUrl: avatarUrl(row.owner_avatar_id, row.owner_image) },
		fullName: `${row.owner_handle}/${row.slug}`,
		gitRepo: row.git_repo,
		submittedTag: row.submitted_tag,
		submittedCommit: row.submitted_commit,
		publishedTag: row.published_tag,
		publishedCommit: row.published_commit,
		submittedChecks: row.submitted_checks ? JSON.parse(row.submitted_checks) : null,
		manifest: row.published_manifest ? JSON.parse(row.published_manifest) : null,
		pwa: row.published_pwa ? JSON.parse(row.published_pwa) : null,
		demoUrl: row.demo_url,
		android: row.android_package && row.android_verified_at ? { package: row.android_package, verifiedAt: row.android_verified_at } : null,
		cowbells: row.cowbell_count,
		checkpointVisibility: row.checkpoint_visibility,
		importedFrom: row.imported_from,
		sessionOf: row.session_of,
		forkedFrom: row.forked_from_path ? { fullName: row.forked_from_path, tag: row.forked_tag, commit: row.forked_commit } : null,
		languages: row.published_languages ? (JSON.parse(row.published_languages) as Record<string, number>) : null,
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
			this.db.prepare(`${SELECT} WHERE ${where} ORDER BY ${search.sort === "cowbells" ? "l.cowbell_count DESC, " : ""}l.updated_at DESC LIMIT ? OFFSET ?`).bind(...params, search.pageSize, offset),
			this.db.prepare(`SELECT COUNT(*) AS total FROM repos l WHERE ${where}`).bind(...params),
		]);
		return {
			items: (rows.results as unknown as RepoRow[]).map(toRepo),
			page: search.page,
			pageSize: search.pageSize,
			total: (count.results[0] as { total: number }).total,
		};
	}

	/** A repo by its path, `owner/slug` (owner handles compare case-insensitively). */
	async findByPath(owner: string, slug: string): Promise<Repo | null> {
		const row = await this.db.prepare(`${SELECT} WHERE o.handle = ? AND l.slug = ?`).bind(owner, slug).first<RepoRow>();
		return row ? toRepo(row) : null;
	}

	/** Old /apps/:slug links (before #102): the published repo that had that slug. */
	async findLegacy(slug: string): Promise<Repo | null> {
		const row = await this.db.prepare(`${SELECT} WHERE l.slug = ? AND l.state = 'published' ORDER BY l.created_at LIMIT 1`).bind(slug).first<RepoRow>();
		return row ? toRepo(row) : null;
	}

	async findById(id: string): Promise<Repo | null> {
		const row = await this.db.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<RepoRow>();
		return row ? toRepo(row) : null;
	}

	/** Repos by id, in the order given (missing ids are skipped). */
	async findByIds(ids: string[]): Promise<Repo[]> {
		if (ids.length === 0) return [];
		const { results } = await this.db.prepare(`${SELECT} WHERE l.id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<RepoRow>();
		const byId = new Map(results.map((r) => [r.id, toRepo(r)]));
		return ids.flatMap((id) => byId.get(id) ?? []);
	}

	/** Repos under any of these owners (a user and their organizations), newest change first. */
	async listByOwners(ownerIds: string[]): Promise<Repo[]> {
		const { results } = await this.db
			.prepare(`${SELECT} WHERE l.owner_id IN (${ownerIds.map(() => "?").join(",")}) AND l.state != 'removed' AND l.session_of IS NULL ORDER BY l.updated_at DESC`)
			.bind(...ownerIds)
			.all<RepoRow>();
		return results.map(toRepo);
	}

	/** An owner's public repos (owner pages). */
	async listPublicByOwner(ownerId: string): Promise<Repo[]> {
		const { results } = await this.db
			.prepare(`${SELECT} WHERE l.owner_id = ? AND l.state = 'published' ORDER BY l.cowbell_count DESC, l.updated_at DESC LIMIT 200`)
			.bind(ownerId)
			.all<RepoRow>();
		return results.map(toRepo);
	}

	/** Published repos of any of these owners (pin candidates, #142), most cowbells first. */
	async listPublicByOwners(ownerIds: string[]): Promise<Repo[]> {
		if (!ownerIds.length) return [];
		const { results } = await this.db
			.prepare(`${SELECT} WHERE l.owner_id IN (${ownerIds.map(() => "?").join(",")}) AND l.state = 'published' ORDER BY l.cowbell_count DESC, l.updated_at DESC LIMIT 500`)
			.bind(...ownerIds)
			.all<RepoRow>();
		return results.map(toRepo);
	}

	/** #142: an owner's pinned repos that are still published, in order. */
	async pinned(ownerId: string): Promise<Repo[]> {
		const { results } = await this.db
			.prepare(`${SELECT} JOIN owner_pins p ON p.repo_id = l.id WHERE p.owner_id = ? AND l.state = 'published' ORDER BY p.position`)
			.bind(ownerId)
			.all<RepoRow>();
		return results.map(toRepo);
	}

	async setPins(ownerId: string, repoIds: string[]): Promise<void> {
		await this.db.batch([
			this.db.prepare("DELETE FROM owner_pins WHERE owner_id = ?").bind(ownerId),
			...repoIds.map((id, i) => this.db.prepare("INSERT INTO owner_pins (owner_id, repo_id, position) VALUES (?, ?, ?)").bind(ownerId, id, i)),
		]);
	}

	/** A new repo id and a slug not yet used, derived from the name. */
	/** Names are unique per owner: alice/todo and acme/todo can both exist. */
	async reserve(ownerId: string, name: string): Promise<{ id: string; slug: string }> {
		return { id: crypto.randomUUID(), slug: await this.uniqueSlug(ownerId, slugify(name)) };
	}

	/** Inserts a draft. Fails on a slug or repo name collision (UNIQUE constraints). */
	async insert(ids: { id: string; slug: string }, ownerId: string, createdBy: string, input: RepoInput, gitRepo: string): Promise<Repo> {
		await this.db
			.prepare(
				"INSERT INTO repos (id, owner_id, created_by, slug, name, summary, description, category, runtime, platforms, license, git_repo, demo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(ids.id, ownerId, createdBy, ids.slug, input.name, input.summary, input.description, input.category, input.runtime, JSON.stringify(input.platforms), input.license, gitRepo, input.demoUrl ?? null)
			.run();
		return (await this.findById(ids.id))!;
	}

	/** #33: the developer's Android verification declaration, or null to clear it. */
	async setAndroid(id: string, pkg: string | null): Promise<void> {
		await this.db
			.prepare("UPDATE repos SET android_package = ?, android_verified_at = CASE WHEN ? IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
			.bind(pkg, pkg, id)
			.run();
	}

	/** #29: marks a new repo as an agent session's fork (hidden from lists, never submitted). */
	async setSessionOf(id: string, sourceId: string): Promise<void> {
		await this.db.prepare("UPDATE repos SET session_of = ? WHERE id = ?").bind(sourceId, id).run();
	}

	/** #30 */
	async setImportedFrom(id: string, source: string): Promise<void> {
		await this.db.prepare("UPDATE repos SET imported_from = ? WHERE id = ?").bind(source, id).run();
	}

	/** #26: marks a new repo as a fork of `source` at its published version. */
	async setForkedFrom(id: string, source: Repo): Promise<void> {
		await this.db.prepare("UPDATE repos SET forked_from = ?, forked_commit = ?, forked_tag = ? WHERE id = ?").bind(source.id, source.publishedCommit, source.publishedTag, id).run();
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
			demo_url: update.demoUrl,
		};
		const set = Object.entries(columns).filter(([, value]) => value !== undefined);
		if (set.length === 0) return;
		await this.db
			.prepare(`UPDATE repos SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
			.bind(...set.map(([, value]) => value), id)
			.run();
	}

	/** Repos an owner has that are not removed (R19 quota). */
	/** R19 quota: repos a user created that are not removed (in any namespace). */
	async countActiveByCreator(userId: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM repos WHERE created_by = ? AND state != 'removed' AND session_of IS NULL").bind(userId).first<{ n: number }>();
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

	private async uniqueSlug(ownerId: string, base: string): Promise<string> {
		const { results } = await this.db
			.prepare("SELECT slug FROM repos WHERE owner_id = ? AND (slug = ? OR slug LIKE ?)")
			.bind(ownerId, base, `${base}-%`)
			.all<{ slug: string }>();
		const taken = new Set(results.map((r) => r.slug));
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) {
			if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
		}
	}
}
