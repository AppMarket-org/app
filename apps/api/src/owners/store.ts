import { avatarUrl, handleProblem, type OwnerPrivacy, type OrgMember, type OrgMembership, type OrgRole, type Owner, type OwnerKind, type OwnerProfile } from "@appmarket/shared";

interface OwnerRow {
	id: string;
	handle: string;
	kind: OwnerKind;
	name: string | null;
	user_name: string | null;
	avatar_id: string | null;
	user_image: string | null;
}

const SELECT = `SELECT o.id, o.handle, o.kind, o.name, o.avatar_id, u.name AS user_name, u.image AS user_image FROM owners o LEFT JOIN "user" u ON u.id = o.user_id`;
const toOwner = (r: OwnerRow): Owner => ({ id: r.id, handle: r.handle, kind: r.kind, name: r.name ?? r.user_name ?? r.handle, avatarUrl: avatarUrl(r.avatar_id, r.user_image) });

/** Suggested handle from an email address: the part before @, hyphenated. */
export function handleFromEmail(email: string): string {
	const local = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
	return local && !handleProblem(local) ? local : "user";
}

/** #102: the shared namespace of users and organizations, and organization membership. */
export class OwnerStore {
	constructor(private readonly db: D1Database) {}

	async byHandle(handle: string): Promise<Owner | null> {
		const row = await this.db.prepare(`${SELECT} WHERE o.handle = ?`).bind(handle).first<OwnerRow>();
		return row ? toOwner(row) : null;
	}

	async byId(id: string): Promise<Owner | null> {
		const row = await this.db.prepare(`${SELECT} WHERE o.id = ?`).bind(id).first<OwnerRow>();
		return row ? toOwner(row) : null;
	}

	/** The user's own owner row, created with a free handle if the user has none yet. */
	async forUser(user: { id: string; email: string }): Promise<Owner> {
		const existing = await this.byId(user.id);
		if (existing) return existing;
		const base = handleFromEmail(user.email);
		for (let n = 1; n < 1000; n++) {
			const handle = n === 1 ? base : `${base.slice(0, 35)}-${n}`;
			const inserted = await this.db
				.prepare("INSERT INTO owners (id, handle, kind, user_id) VALUES (?, ?, 'user', ?) ON CONFLICT DO NOTHING")
				.bind(user.id, handle, user.id)
				.run();
			if (inserted.meta.changes) return (await this.byId(user.id))!;
			// Another request created the row for this user meanwhile.
			const again = await this.byId(user.id);
			if (again) return again;
		}
		throw new Error("No free handle");
	}

	/** Renames a user's or org's handle. Returns false if it is taken. */
	async rename(ownerId: string, handle: string): Promise<boolean> {
		const result = await this.db.prepare("UPDATE owners SET handle = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM owners WHERE handle = ? AND id != ?)").bind(handle, ownerId, handle, ownerId).run();
		return result.meta.changes > 0;
	}

	/** Creates an organization with the user as its first owner. Returns null if the handle is taken. */
	async createOrg(userId: string, handle: string, name: string): Promise<Owner | null> {
		if (await this.byHandle(handle)) return null;
		const id = crypto.randomUUID();
		try {
			await this.db.batch([
				this.db.prepare("INSERT INTO owners (id, handle, kind, name) VALUES (?, ?, 'org', ?)").bind(id, handle, name),
				this.db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, userId),
			]);
		} catch (error) {
			if (String(error).includes("UNIQUE")) return null;
			throw error;
		}
		return this.byId(id);
	}

	/** #139: public profile fields (empty ones left out). */
	async profile(ownerId: string, view: "public" | "self" = "public"): Promise<OwnerProfile | null> {
		const row = await this.db
			.prepare(`SELECT o.bio, o.location, o.website, o.hide_activity, o.hide_location, COALESCE(u.createdAt, o.created_at) AS since FROM owners o LEFT JOIN "user" u ON u.id = o.user_id WHERE o.id = ?`)
			.bind(ownerId)
			.first<{ bio: string | null; location: string | null; website: string | null; hide_activity: number; hide_location: number; since: string | number }>();
		if (!row) return null;
		// #146: hidden sections are left out of the public profile; the owner still edits them.
		if (view === "public" && row.hide_location) row.location = null;
		const since = typeof row.since === "number" || /^\d+$/.test(String(row.since)) ? new Date(Number(row.since)).toISOString() : new Date(row.since).toISOString();
		return {
			...(row.bio ? { bio: row.bio } : {}),
			...(row.location ? { location: row.location } : {}),
			...(row.website ? { website: row.website } : {}),
			memberSince: since,
			...(row.hide_activity ? { activityHidden: true } : {}),
		};
	}

	/** #146 */
	async privacy(ownerId: string): Promise<OwnerPrivacy> {
		const row = await this.db.prepare("SELECT private_contributions, hide_activity, hide_location FROM owners WHERE id = ?").bind(ownerId).first<{ private_contributions: number; hide_activity: number; hide_location: number }>();
		return { privateContributions: row?.private_contributions === 1, hideActivity: row?.hide_activity === 1, hideLocation: row?.hide_location === 1 };
	}

	/** Sets the given fields; null clears one (a user's name then falls back to the sign-in name). */
	async updateProfile(
		ownerId: string,
		update: { name?: string | null; bio?: string | null; location?: string | null; website?: string | null; privateContributions?: boolean; hideActivity?: boolean; hideLocation?: boolean },
	): Promise<void> {
		const COLUMNS = { name: "name", bio: "bio", location: "location", website: "website", privateContributions: "private_contributions", hideActivity: "hide_activity", hideLocation: "hide_location" } as const;
		const keys = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => update[k] !== undefined);
		if (!keys.length) return;
		const value = (k: keyof typeof COLUMNS) => (typeof update[k] === "boolean" ? (update[k] ? 1 : 0) : (update[k] ?? null));
		await this.db
			.prepare(`UPDATE owners SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`)
			.bind(...keys.map(value), ownerId)
			.run();
	}

	/** #140: the owner's uploaded picture (null: none). */
	async avatar(avatarId: string): Promise<{ ownerId: string; contentType: string } | null> {
		const row = await this.db.prepare("SELECT id, avatar_type FROM owners WHERE avatar_id = ?").bind(avatarId).first<{ id: string; avatar_type: string }>();
		return row ? { ownerId: row.id, contentType: row.avatar_type } : null;
	}

	/** Sets (or clears) the uploaded picture; returns the previous one's id so its bytes can be deleted. */
	async setAvatar(ownerId: string, avatar: { id: string; contentType: string } | null): Promise<string | null> {
		const previous = await this.db.prepare("SELECT avatar_id FROM owners WHERE id = ?").bind(ownerId).first<{ avatar_id: string | null }>();
		await this.db.prepare("UPDATE owners SET avatar_id = ?, avatar_type = ? WHERE id = ?").bind(avatar?.id ?? null, avatar?.contentType ?? null, ownerId).run();
		return previous?.avatar_id ?? null;
	}

	/** Organizations the user belongs to, with their role. */
	async membershipsOf(userId: string): Promise<OrgMembership[]> {
		const { results } = await this.db
			.prepare(
				`SELECT m.role, m.public, o.id, o.handle, o.kind, o.name, o.avatar_id, NULL AS user_name, NULL AS user_image FROM org_members m JOIN owners o ON o.id = m.org_id
				 WHERE m.user_id = ? ORDER BY o.handle`,
			)
			.bind(userId)
			.all<OwnerRow & { role: OrgRole; public: number }>();
		return results.map((r) => ({ org: toOwner(r), role: r.role, public: r.public === 1 }));
	}

	/** #141: organizations a user shows on their profile. */
	async publicOrgsOf(userId: string): Promise<Owner[]> {
		const { results } = await this.db
			.prepare(`SELECT o.id, o.handle, o.kind, o.name, o.avatar_id, NULL AS user_name, NULL AS user_image FROM org_members m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ? AND m.public = 1 ORDER BY o.handle`)
			.bind(userId)
			.all<OwnerRow>();
		return results.map(toOwner);
	}

	/** #141: members who show their membership on the organization's profile. */
	async publicMembers(orgId: string): Promise<Owner[]> {
		const { results } = await this.db
			.prepare(`${SELECT} JOIN org_members m ON m.user_id = o.id WHERE m.org_id = ? AND m.public = 1 ORDER BY o.handle`)
			.bind(orgId)
			.all<OwnerRow>();
		return results.map(toOwner);
	}

	async membershipPublic(orgId: string, userId: string): Promise<boolean> {
		return (await this.db.prepare("SELECT public FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, userId).first<{ public: number }>())?.public === 1;
	}

	async setMembershipPublic(orgId: string, userId: string, visible: boolean): Promise<boolean> {
		const result = await this.db.prepare("UPDATE org_members SET public = ? WHERE org_id = ? AND user_id = ?").bind(visible ? 1 : 0, orgId, userId).run();
		return result.meta.changes > 0;
	}

	async orgIdsOf(userId: string): Promise<string[]> {
		const { results } = await this.db.prepare("SELECT org_id FROM org_members WHERE user_id = ?").bind(userId).all<{ org_id: string }>();
		return results.map((r) => r.org_id);
	}

	async roleIn(orgId: string, userId: string): Promise<OrgRole | null> {
		const row = await this.db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, userId).first<{ role: OrgRole }>();
		return row?.role ?? null;
	}

	async members(orgId: string): Promise<OrgMember[]> {
		const { results } = await this.db
			.prepare(
				`SELECT m.user_id, m.role, o.handle, COALESCE(o.name, u.name) AS name, o.avatar_id, u.image FROM org_members m JOIN "user" u ON u.id = m.user_id JOIN owners o ON o.id = m.user_id
				 WHERE m.org_id = ? ORDER BY m.role DESC, o.handle`,
			)
			.bind(orgId)
			.all<{ user_id: string; role: OrgRole; handle: string; name: string; avatar_id: string | null; image: string | null }>();
		return results.map((r) => ({ userId: r.user_id, handle: r.handle, name: r.name, role: r.role, avatarUrl: avatarUrl(r.avatar_id, r.image) }));
	}

	/** Adds or updates a member. */
	async setMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
		await this.db
			.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role")
			.bind(orgId, userId, role)
			.run();
	}

	async removeMember(orgId: string, userId: string): Promise<void> {
		await this.db.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, userId).run();
	}

	async ownerCount(orgId: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'").bind(orgId).first<{ n: number }>();
		return row?.n ?? 0;
	}
}
