import type { SessionInfo } from "@appmarket/shared";
import { handleSchema, orgCreateSchema, orgMemberSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { RepoStore } from "../repos/repository.ts";
import { OwnerStore } from "./store.ts";

type Ctx = { Variables: AuthVariables };
const owners = () => new OwnerStore(env.DB);
const invalid = (error: z.ZodError) => ({ error: "invalid", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

/** Public owner pages: a user or organization and its public repos. Mounted under /api/owners. */
export const ownerRoutes = new Hono<Ctx>().get("/:handle", async (c) => {
	const owner = await owners().byHandle(c.req.param("handle"));
	if (!owner) return c.json({ error: "not_found" }, 404);
	return c.json({ owner, repos: await new RepoStore(env.DB).listPublicByOwner(owner.id) });
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
			`SELECT id, userAgent, createdAt, expiresAt, clientId, scopes, deviceName FROM "session" WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC`,
		)
			.bind(session.user.id, Date.now())
			.all<{ id: string; userAgent: string | null; createdAt: number | string; expiresAt: number | string; clientId: string | null; scopes: string | null; deviceName: string | null }>();
		const iso = (v: number | string) => new Date(typeof v === "number" ? v : Number.isNaN(Number(v)) ? v : Number(v)).toISOString();
		return c.json({
			items: results.map((r): SessionInfo => ({
				id: r.id,
				userAgent: r.userAgent || null,
				createdAt: iso(r.createdAt),
				expiresAt: iso(r.expiresAt),
				current: r.id === session.session.id,
				device: r.scopes == null ? null : { clientId: r.clientId ?? "", name: r.deviceName ?? "Device", scopes: r.scopes.split(" ").filter(Boolean) },
			})),
		});
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
		return c.json({ org, role, members: await store.members(org.id) });
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
