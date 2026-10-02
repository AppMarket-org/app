import type { CategorySlug, Listing, ListingEvent, ListingInput, ListingPage, ListingSearch, ListingState, ListingUpdate, TransitionActor, TransitionRequest } from "@appmarket/shared";
import { slugify } from "@appmarket/shared";
import { buildSearchWhere } from "./search.ts";
import { transitionUpdate } from "./transition-sql.ts";

interface ListingRow {
	id: string;
	slug: string;
	name: string;
	summary: string;
	description: string;
	category: CategorySlug;
	price_cents: number;
	state: ListingState;
	owner_id: string;
	owner_name: string;
	repo_name: string | null;
	submitted_tag: string | null;
	submitted_commit: string | null;
	published_tag: string | null;
	published_commit: string | null;
	created_at: string;
	updated_at: string;
}

const SELECT = `SELECT l.*, u.name AS owner_name FROM listings l JOIN "user" u ON u.id = l.owner_id`;

function toListing(row: ListingRow): Listing {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		summary: row.summary,
		description: row.description,
		category: row.category,
		priceCents: row.price_cents,
		state: row.state,
		owner: { id: row.owner_id, name: row.owner_name },
		repoName: row.repo_name,
		submittedTag: row.submitted_tag,
		submittedCommit: row.submitted_commit,
		publishedTag: row.published_tag,
		publishedCommit: row.published_commit,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** D1 access for listings (PRD R1). */
export class ListingRepository {
	constructor(private readonly db: D1Database) {}

	async search(search: ListingSearch): Promise<ListingPage> {
		const { where, params } = buildSearchWhere(search);
		const offset = (search.page - 1) * search.pageSize;
		const [rows, count] = await this.db.batch([
			this.db.prepare(`${SELECT} WHERE ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`).bind(...params, search.pageSize, offset),
			this.db.prepare(`SELECT COUNT(*) AS total FROM listings l WHERE ${where}`).bind(...params),
		]);
		return {
			items: (rows.results as unknown as ListingRow[]).map(toListing),
			page: search.page,
			pageSize: search.pageSize,
			total: (count.results[0] as { total: number }).total,
		};
	}

	async findBySlug(slug: string): Promise<Listing | null> {
		const row = await this.db.prepare(`${SELECT} WHERE l.slug = ?`).bind(slug).first<ListingRow>();
		return row ? toListing(row) : null;
	}

	async listByOwner(ownerId: string): Promise<Listing[]> {
		const { results } = await this.db
			.prepare(`${SELECT} WHERE l.owner_id = ? AND l.state != 'removed' ORDER BY l.updated_at DESC`)
			.bind(ownerId)
			.all<ListingRow>();
		return results.map(toListing);
	}

	/** A new listing id and a slug not yet used, derived from the name. */
	async reserve(name: string): Promise<{ id: string; slug: string }> {
		return { id: crypto.randomUUID(), slug: await this.uniqueSlug(slugify(name)) };
	}

	/** Inserts a draft. Fails on a slug or repo name collision (UNIQUE constraints). */
	async insert(ids: { id: string; slug: string }, ownerId: string, input: ListingInput, repoName: string): Promise<Listing> {
		await this.db
			.prepare("INSERT INTO listings (id, owner_id, slug, name, summary, description, category, repo_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(ids.id, ownerId, ids.slug, input.name, input.summary, input.description, input.category, repoName)
			.run();
		return (await this.findBySlug(ids.slug))!;
	}

	/** Updates editable fields. The slug stays fixed so published URLs never break. */
	async update(id: string, update: ListingUpdate): Promise<void> {
		const columns = { name: update.name, summary: update.summary, description: update.description, category: update.category };
		const set = Object.entries(columns).filter(([, value]) => value !== undefined);
		if (set.length === 0) return;
		await this.db
			.prepare(`UPDATE listings SET ${set.map(([column]) => `${column} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
			.bind(...set.map(([, value]) => value), id)
			.run();
	}

	/** Listings an owner has that are not removed (R19 quota). */
	async countActiveByOwner(ownerId: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM listings WHERE owner_id = ? AND state != 'removed'").bind(ownerId).first<{ n: number }>();
		return row?.n ?? 0;
	}

	/** Listings in one state, oldest first (moderation queue, R18). */
	async listByState(state: ListingState): Promise<Listing[]> {
		const { results } = await this.db.prepare(`${SELECT} WHERE l.state = ? ORDER BY l.updated_at ASC`).bind(state).all<ListingRow>();
		return results.map(toListing);
	}

	/**
	 * Applies a lifecycle transition and records it, atomically. The update only matches while the
	 * listing is still in `from`, so a concurrent transition makes this return false instead of
	 * overwriting it.
	 */
	async transition(
		listing: Listing,
		request: TransitionRequest,
		actor: { id: string; role: TransitionActor },
		/** For a submit: the commit the tag resolves to now. */
		submittedCommit: string | null = null,
	): Promise<boolean> {
		const [tag, commit] =
			request.to === "submitted" ? [request.tag, submittedCommit] : request.to === "published" ? [listing.submittedTag, listing.submittedCommit] : [null, null];
		const note = "note" in request ? (request.note ?? null) : null;
		const [update] = await this.db.batch([
			(({ sql, params }) => this.db.prepare(sql).bind(...params))(transitionUpdate(listing, request, actor.id, submittedCommit)),
			this.db
				.prepare(
					"INSERT INTO listing_events (listing_id, from_state, to_state, actor_id, actor_role, tag, commit_hash, note) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0",
				)
				.bind(listing.id, listing.state, request.to, actor.id, actor.role, tag, commit, note),
		]);
		return update.meta.changes > 0;
	}

	async events(listingId: string): Promise<ListingEvent[]> {
		const { results } = await this.db
			.prepare(
				`SELECT e.*, u.name AS actor_name FROM listing_events e JOIN "user" u ON u.id = e.actor_id WHERE e.listing_id = ? ORDER BY e.id DESC`,
			)
			.bind(listingId)
			.all<{
				from_state: ListingState;
				to_state: ListingState;
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

	private async uniqueSlug(base: string): Promise<string> {
		const { results } = await this.db
			.prepare("SELECT slug FROM listings WHERE slug = ? OR slug LIKE ?")
			.bind(base, `${base}-%`)
			.all<{ slug: string }>();
		const taken = new Set(results.map((r) => r.slug));
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) {
			if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
		}
	}
}
