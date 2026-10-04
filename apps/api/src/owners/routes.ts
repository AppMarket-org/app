import { MAX_PINS, type ActivityPage, type ContributionCalendar, type Owner, type Repo, type SessionInfo } from "@appmarket/shared";
import { purgeOwnerPage } from "../routes/seo.ts";
import { ContributionStore } from "../contributions/store.ts";
import { handleSchema, orgCreateSchema, orgMemberSchema, profileUpdateSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { RepoStore } from "../repos/repository.ts";
import { removeAvatar, replaceAvatar } from "./avatars.ts";
import { OwnerStore } from "./store.ts";

type Ctx = { Variables: AuthVariables };
const owners = () => new OwnerStore(env.DB);
const invalid = (error: z.ZodError) => ({ error: "invalid", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

/** Public owner pages: a user or organization and its public repos. Mounted under /api/owners. */
export const ownerRoutes = new Hono<Ctx>()
	// #144: the contribution calendar (users), for a year or the last 12 months.
	.get("/:handle/contributions", async (c) => {
		const owner = await owners().byHandle(c.req.param("handle"));
		if (!owner || owner.kind !== "user") return c.json({ error: "not_found" }, 404);
		const year = c.req.query("year");
		const today = new Date().toISOString().slice(0, 10);
		let from: string;
		let to: string;
		if (year && /^\d{4}$/.test(year)) {
			from = `${year}-01-01`;
			to = `${year}-12-31` < today ? `${year}-12-31` : today;
		} else {
			// The last 52 weeks plus the current partial week, starting on a Sunday like GitHub.
			const start = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000);
			start.setUTCDate(start.getUTCDate() - start.getUTCDay());
			from = start.toISOString().slice(0, 10);
			to = today;
		}
		const privacy = await owners().privacy(owner.id);
		const data = await new ContributionStore(env.DB).calendar(owner.id, from, to, privacy.privateContributions);
		// The profile page is cached at the edge (and purged on changes); privacy changes must show at once here.
		c.header("Cache-Control", "no-cache");
		return c.json({ from, to, ...data } satisfies ContributionCalendar);
	})
	// #145: activity by month (users: theirs; organizations: on their repos).
	.get("/:handle/activity", async (c) => {
		const owner = await owners().byHandle(c.req.param("handle"));
		if (!owner) return c.json({ error: "not_found" }, 404);
		const year = c.req.query("year");
		const today = new Date().toISOString().slice(0, 10);
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
		const [from, end] = year && /^\d{4}$/.test(year) ? [`${year}-01-01`, `${Number(year) + 1}-01-01`] : [new Date(Date.parse(`${today}T00:00:00Z`) - 371 * 86_400_000).toISOString().slice(0, 10), tomorrow];
		const before = c.req.query("before");
		const upper = before && /^\d{4}-\d{2}-\d{2}$/.test(before) && before < end ? before : end;
		const privacy = await owners().privacy(owner.id);
		c.header("Cache-Control", "no-cache");
		// #146: a hidden feed is hidden from the API too.
		if (privacy.hideActivity) return c.json({ months: [], next: null, hidden: true } satisfies ActivityPage);
		const page = await new ContributionStore(env.DB).activity(owner.kind === "user" ? { userId: owner.id } : { ownerId: owner.id }, from, upper, 3, owner.kind === "user" && privacy.privateContributions);
		return c.json(page);
	})
	.get("/:handle", async (c) => {
	const owner = await owners().byHandle(c.req.param("handle"));
	if (!owner) return c.json({ error: "not_found" }, 404);
	const store = owners();
	const repoStore = new RepoStore(env.DB);
	const [profile, repos, pins, related] = await Promise.all([
		store.profile(owner.id),
		repoStore.listPublicByOwner(owner.id),
		repoStore.pinned(owner.id),
		// #141: a user's public organizations, or an organization's public members.
		owner.kind === "user" ? store.publicOrgsOf(owner.id) : store.publicMembers(owner.id),
	]);
	// #142: without pins, the most-cowbelled public repos stand in.
	const pinned = pins.length ? { pinned: pins, pinnedFallback: false } : { pinned: repos.slice(0, MAX_PINS), pinnedFallback: true };
	return c.json({ owner, profile, repos, ...pinned, ...(owner.kind === "user" ? { orgs: related } : { people: related }) });
});

/** The signed-in user's handle and organizations. Mounted under /api/me. */
export const meRoutes = new Hono<Ctx>()
	.use(requireRole())
	.get("/owner", async (c) => {
		const user = c.get("session")!.user;
		const store = owners();
		return c.json({ owner: await store.forUser(user), orgs: await store.membershipsOf(user.id) });
	})
	// #107: a device session names itself (the CLI sends the hostname or --device-name).
	.put("/device", async (c) => {
		const session = c.get("session")!;
		if (!session.deviceScopes) return c.json({ error: "not_a_device" }, 400);
		const name = String(((await c.req.json().catch(() => ({}))) as { name?: unknown }).name ?? "").trim().slice(0, 64);
		if (!name) return c.json({ error: "invalid", issues: [{ path: "name", message: "Give the device a name." }] }, 400);
		await env.DB.prepare(`UPDATE "session" SET deviceName = ? WHERE id = ?`).bind(name, session.session.id).run();
		return c.json({ deviceName: name });
	})
	// #139: the signed-in user's profile.
	.get("/profile", async (c) => {
		const store = owners();
		const self = await store.forUser(c.get("session")!.user);
		return c.json({ owner: self, profile: await store.profile(self.id, "self"), privacy: await store.privacy(self.id) });
	})
	.patch("/profile", async (c) => {
		const body = profileUpdateSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		const store = owners();
		const self = await store.forUser(c.get("session")!.user);
		await store.updateProfile(self.id, body.data);
		c.executionCtx.waitUntil(purgeOwnerPage(self.handle));
		return c.json({ owner: await store.byId(self.id), profile: await store.profile(self.id, "self"), privacy: await store.privacy(self.id) });
	})
	// #142: pins.
	.get("/pins", async (c) => {
		const self = await owners().forUser(c.get("session")!.user);
		return c.json(await pinState(self, c.get("session")!.orgIds));
	})
	.put("/pins", async (c) => {
		const self = await owners().forUser(c.get("session")!.user);
		return savePins(c, self, c.get("session")!.orgIds);
	})
	// #140: profile picture.
	.put("/avatar", async (c) => replaceAvatar(c, (await owners().forUser(c.get("session")!.user)).id))
	.delete("/avatar", async (c) => removeAvatar(c, (await owners().forUser(c.get("session")!.user)).id))
	.patch("/handle", async (c) => {
		const body = handleSchema.safeParse(((await c.req.json().catch(() => ({}))) as { handle?: unknown }).handle);
		if (!body.success) return c.json(invalid(body.error), 400);
		const user = c.get("session")!.user;
		const store = owners();
		const self = await store.forUser(user);
		if (!(await store.rename(self.id, body.data))) return c.json({ error: "taken" }, 409);
		logEvent("handle.changed", { user: user.id, from: self.handle, to: body.data });
		return c.json(await store.byId(self.id));
	});

/** #104: the user's sessions (browsers and device logins), without tokens; sign one out. */
export const sessionRoutes = new Hono<Ctx>()
	.use(requireRole())
	.get("/", async (c) => {
		const session = c.get("session")!;
		const { results } = await env.DB.prepare(
			`SELECT id, userAgent, createdAt, expiresAt, clientId, scopes, deviceName, lastUsedAt, lastIpPrefix FROM "session" WHERE userId = ? AND expiresAt > ? ORDER BY COALESCE(lastUsedAt, createdAt) DESC`,
		)
			.bind(session.user.id, Date.now())
			.all<{ id: string; userAgent: string | null; createdAt: number | string; expiresAt: number | string; clientId: string | null; scopes: string | null; deviceName: string | null; lastUsedAt: string | null; lastIpPrefix: string | null }>();
		const iso = (v: number | string) => new Date(typeof v === "number" ? v : Number.isNaN(Number(v)) ? v : Number(v)).toISOString();
		return c.json({
			items: results.map((r): SessionInfo => ({
				id: r.id,
				userAgent: r.userAgent || null,
				createdAt: iso(r.createdAt),
				expiresAt: iso(r.expiresAt),
				current: r.id === session.session.id,
				device: r.scopes == null ? null : { clientId: r.clientId ?? "", name: r.deviceName ?? "Device", scopes: r.scopes.split(" ").filter(Boolean) },
				lastUsedAt: r.lastUsedAt,
				ipPrefix: r.lastIpPrefix,
			})),
		});
	})
	// #133: rename a device login.
	.patch("/:id", async (c) => {
		const name = String(((await c.req.json().catch(() => ({}))) as { name?: unknown }).name ?? "").trim().slice(0, 64);
		if (!name) return c.json({ error: "invalid", issues: [{ path: "name", message: "Give the device a name." }] }, 400);
		const result = await env.DB.prepare(`UPDATE "session" SET deviceName = ? WHERE id = ? AND userId = ? AND scopes IS NOT NULL`).bind(name, c.req.param("id"), c.get("session")!.user.id).run();
		return result.meta.changes ? c.json({ name }) : c.json({ error: "not_found" }, 404);
	})
	.delete("/:id", async (c) => {
		const result = await env.DB.prepare(`DELETE FROM "session" WHERE id = ? AND userId = ?`).bind(c.req.param("id"), c.get("session")!.user.id).run();
		return result.meta.changes ? c.json({ revoked: true }) : c.json({ error: "not_found" }, 404);
	});

/** Organizations: create, rename, members. Mounted under /api/orgs. */
export const orgRoutes = new Hono<Ctx>()
	.use(requireRole())
	.post("/", async (c) => {
		const body = orgCreateSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		const user = c.get("session")!.user;
		const org = await owners().createOrg(user.id, body.data.handle, body.data.name);
		if (!org) return c.json({ error: "taken" }, 409);
		logEvent("org.created", { org: org.handle, user: user.id });
		return c.json(org, 201);
	})
	.get("/:handle/members", async (c) => {
		const org = await orgFor(c);
		if (!org) return c.json({ error: "not_found" }, 404);
		const store = owners();
		const role = await store.roleIn(org.id, c.get("session")!.user.id);
		if (!role) return c.json({ error: "not_found" }, 404);
		const userId = c.get("session")!.user.id;
		return c.json({ org, role, public: await store.membershipPublic(org.id, userId), members: await store.members(org.id) });
	})
	.patch("/:handle", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		const raw = (await c.req.json().catch(() => ({}))) as { handle?: unknown; name?: unknown };
		const store = owners();
		if (raw.handle !== undefined) {
			const handle = handleSchema.safeParse(raw.handle);
			if (!handle.success) return c.json(invalid(handle.error), 400);
			if (!(await store.rename(org.id, handle.data))) return c.json({ error: "taken" }, 409);
		}
		if (typeof raw.name === "string" && raw.name.trim() && raw.name.length <= 80) {
			await env.DB.prepare("UPDATE owners SET name = ? WHERE id = ?").bind(raw.name.trim(), org.id).run();
		}
		return c.json(await store.byId(org.id));
	})
	// #139: organization profile, owners only (members get 404 like everyone else).
	.get("/:handle/profile", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		return c.json({ owner: org, profile: await owners().profile(org.id, "self"), privacy: await owners().privacy(org.id) });
	})
	.patch("/:handle/profile", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		const body = profileUpdateSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		// An organization always has a display name.
		if (body.data.name === null) return c.json({ error: "invalid", issues: [{ path: "name", message: "An organization needs a name." }] }, 400);
		const store = owners();
		await store.updateProfile(org.id, body.data);
		c.executionCtx.waitUntil(purgeOwnerPage(org.handle));
		return c.json({ owner: await store.byId(org.id), profile: await store.profile(org.id, "self"), privacy: await store.privacy(org.id) });
	})
	// #142: organization pins, owners only.
	.get("/:handle/pins", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		return c.json(await pinState(org, []));
	})
	.put("/:handle/pins", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		return savePins(c, org, []);
	})
	// #140: organization logo, owners only.
	.put("/:handle/avatar", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		return replaceAvatar(c, org.id);
	})
	.delete("/:handle/avatar", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		return removeAvatar(c, org.id);
	})
	// #141: a member shows (or hides) their own membership.
	.put("/:handle/membership", async (c) => {
		const org = await orgFor(c);
		if (!org) return c.json({ error: "not_found" }, 404);
		const visible = ((await c.req.json().catch(() => ({}))) as { public?: unknown }).public;
		if (typeof visible !== "boolean") return c.json({ error: "invalid", issues: [{ path: "public", message: "true or false" }] }, 400);
		const store = owners();
		if (!(await store.setMembershipPublic(org.id, c.get("session")!.user.id, visible))) return c.json({ error: "not_found" }, 404);
		// Both profiles list the membership.
		const self = await store.forUser(c.get("session")!.user);
		c.executionCtx.waitUntil(Promise.all([purgeOwnerPage(org.handle), purgeOwnerPage(self.handle)]).then(() => undefined));
		return c.json({ public: visible });
	})
	.put("/:handle/members", async (c) => {
		const org = await orgFor(c);
		if (!org || !(await isOrgOwner(c, org.id))) return c.json({ error: "not_found" }, 404);
		const body = orgMemberSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		const store = owners();
		const person = await store.byHandle(body.data.handle);
		if (!person || person.kind !== "user") return c.json({ error: "no_such_user" }, 404);
		// Never leave an organization without an owner.
		if (body.data.role === "member" && (await store.roleIn(org.id, person.id)) === "owner" && (await store.ownerCount(org.id)) <= 1) {
			return c.json({ error: "last_owner" }, 409);
		}
		await store.setMember(org.id, person.id, body.data.role);
		logEvent("org.member_set", { org: org.handle, member: person.handle, role: body.data.role });
		return c.json({ members: await store.members(org.id) });
	})
	.delete("/:handle/members/:member", async (c) => {
		const org = await orgFor(c);
		const userId = c.get("session")!.user.id;
		if (!org) return c.json({ error: "not_found" }, 404);
		const store = owners();
		// Only members may act here, so non-members never learn who is in the organization.
		const callerRole = await store.roleIn(org.id, userId);
		if (!callerRole) return c.json({ error: "not_found" }, 404);
		const person = await store.byHandle(c.req.param("member"));
		const personRole = person ? await store.roleIn(org.id, person.id) : null;
		if (!person || !personRole) return c.json({ error: "not_found" }, 404);
		// Org owners remove anyone; members can leave.
		const leaving = person.id === userId;
		if (!leaving && callerRole !== "owner") return c.json({ error: "not_found" }, 404);
		if (personRole === "owner" && (await store.ownerCount(org.id)) <= 1) return c.json({ error: "last_owner" }, 409);
		await store.removeMember(org.id, person.id);
		logEvent("org.member_removed", { org: org.handle, member: person.handle });
		// Someone who just left is no longer a member: no roster for them.
		return c.json({ members: leaving ? [] : await store.members(org.id) });
	});

/** #142: what an owner may pin: its own public repos, and for a user also their organizations'. */
async function pinState(owner: Owner, orgIds: string[]): Promise<{ pinned: Repo[]; candidates: Repo[] }> {
	const repos = new RepoStore(env.DB);
	const [pinned, candidates] = await Promise.all([repos.pinned(owner.id), repos.listPublicByOwners([owner.id, ...(owner.kind === "user" ? orgIds : [])])]);
	return { pinned, candidates };
}

async function savePins(c: Context<Ctx>, owner: Owner, orgIds: string[]): Promise<Response> {
	const raw = ((await c.req.json().catch(() => ({}))) as { repos?: unknown }).repos;
	if (!Array.isArray(raw) || raw.some((r) => typeof r !== "string") || new Set(raw).size !== raw.length) {
		return c.json({ error: "invalid", issues: [{ path: "repos", message: "A list of distinct owner/repo paths." }] }, 400);
	}
	if (raw.length > MAX_PINS) return c.json({ error: "too_many", max: MAX_PINS }, 400);
	const { candidates } = await pinState(owner, orgIds);
	const byPath = new Map(candidates.map((r) => [r.fullName, r]));
	const unknown = (raw as string[]).filter((p) => !byPath.has(p));
	if (unknown.length) return c.json({ error: "not_pinnable", repos: unknown }, 400);
	const repos = new RepoStore(env.DB);
	await repos.setPins(owner.id, (raw as string[]).map((p) => byPath.get(p)!.id));
	c.executionCtx.waitUntil(purgeOwnerPage(owner.handle));
	return c.json({ pinned: await repos.pinned(owner.id) });
}

async function orgFor(c: Context<Ctx>) {
	const owner = await owners().byHandle(c.req.param("handle")!);
	return owner?.kind === "org" ? owner : null;
}

async function isOrgOwner(c: Context<Ctx>, orgId: string): Promise<boolean> {
	return (await owners().roleIn(orgId, c.get("session")!.user.id)) === "owner";
}

/** Old /apps/:slug links (before #102). Mounted under /api/legacy. */
export const legacyRoutes = new Hono<Ctx>().get("/apps/:slug", async (c) => {
	const repo = await new RepoStore(env.DB).findLegacy(c.req.param("slug"));
	return repo ? c.json({ fullName: repo.fullName }) : c.json({ error: "not_found" }, 404);
});
