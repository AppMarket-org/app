import { handleProblem, type OrgMember, type OrgMembership, type OrgRole, type Owner, type OwnerKind } from "@appmarket/shared";

interface OwnerRow {
	id: string;
	handle: string;
	kind: OwnerKind;
	name: string | null;
	user_name: string | null;
}

const SELECT = `SELECT o.id, o.handle, o.kind, o.name, u.name AS user_name FROM owners o LEFT JOIN "user" u ON u.id = o.user_id`;
const toOwner = (r: OwnerRow): Owner => ({ id: r.id, handle: r.handle, kind: r.kind, name: r.name ?? r.user_name ?? r.handle });

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

	/** Organizations the user belongs to, with their role. */
	async membershipsOf(userId: string): Promise<OrgMembership[]> {
		const { results } = await this.db
			.prepare(
				`SELECT m.role, o.id, o.handle, o.kind, o.name, NULL AS user_name FROM org_members m JOIN owners o ON o.id = m.org_id
				 WHERE m.user_id = ? ORDER BY o.handle`,
			)
			.bind(userId)
			.all<OwnerRow & { role: OrgRole }>();
		return results.map((r) => ({ org: toOwner(r), role: r.role }));
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
				`SELECT m.user_id, m.role, o.handle, u.name FROM org_members m JOIN "user" u ON u.id = m.user_id JOIN owners o ON o.id = m.user_id
				 WHERE m.org_id = ? ORDER BY m.role DESC, o.handle`,
			)
			.bind(orgId)
			.all<{ user_id: string; role: OrgRole; handle: string; name: string }>();
		return results.map((r) => ({ userId: r.user_id, handle: r.handle, name: r.name, role: r.role }));
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
