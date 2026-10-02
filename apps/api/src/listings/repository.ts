import type { CategorySlug, Listing, ListingEvent, ListingInput, ListingPage, ListingSearch, ListingState, ListingUpdate, TransitionActor, TransitionRequest } from "@appmarket/shared";
import { slugify } from "@appmarket/shared";
import { buildSearchWhere } from "./search.ts";

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
	published_tag: string | null;
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
		publishedTag: row.published_tag,
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

	/** Creates a draft with a unique slug derived from the name. */
	async create(ownerId: string, input: ListingInput): Promise<Listing> {
		const id = crypto.randomUUID();
		const slug = await this.uniqueSlug(slugify(input.name));
		await this.db
			.prepare("INSERT INTO listings (id, owner_id, slug, name, summary, description, category) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.bind(id, ownerId, slug, input.name, input.summary, input.description, input.category)
			.run();
		return (await this.findBySlug(slug))!;
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
	async transition(listing: Listing, request: TransitionRequest, actor: { id: string; role: TransitionActor }): Promise<boolean> {
		const sets: Record<ListingState, string> = {
			submitted: "submitted_tag = ?1",
			draft: "submitted_tag = NULL",
			published: "published_tag = submitted_tag, submitted_tag = NULL, approved_by = ?2",
			unpublished: "submitted_tag = NULL",
			removed: "submitted_tag = NULL",
		};
		const tag = request.to === "submitted" ? request.tag : request.to === "published" ? listing.submittedTag : null;
		const note = "note" in request ? (request.note ?? null) : null;
		const [update] = await this.db.batch([
			this.db
				.prepare(`UPDATE listings SET state = ?3, ${sets[request.to]}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?4 AND state = ?5`)
				.bind(request.to === "submitted" ? request.tag : null, actor.id, request.to, listing.id, listing.state),
			this.db
				.prepare("INSERT INTO listing_events (listing_id, from_state, to_state, actor_id, actor_role, tag, note) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0")
				.bind(listing.id, listing.state, request.to, actor.id, actor.role, tag, note),
		]);
		return update.meta.changes > 0;
	}

	async events(listingId: string): Promise<ListingEvent[]> {
		const { results } = await this.db
			.prepare(
				`SELECT e.*, u.name AS actor_name FROM listing_events e JOIN "user" u ON u.id = e.actor_id WHERE e.listing_id = ? ORDER BY e.id DESC`,
			)
			.bind(listingId)
			.all<{ from_state: ListingState; to_state: ListingState; actor_id: string; actor_name: string; actor_role: TransitionActor; tag: string | null; note: string | null; created_at: string }>();
		return results.map((r) => ({
			from: r.from_state,
			to: r.to_state,
			actor: { id: r.actor_id, name: r.actor_name, role: r.actor_role },
			tag: r.tag,
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
