import { ANDROID_PACKAGE, MAX_REPOS_PER_DEVELOPER, SCREENSHOT_LIMITS, TOKEN_TTL, canTransition, type Repo, type GitToken, type Role, type TransitionActor } from "@appmarket/shared";
import { repoInputSchema, repoSearchSchema, repoUpdateSchema, tokenRequestSchema, transitionSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { strictLimit } from "../strict-limit.ts";
import {
	createGitRepo,
	forkGitRepo,
	importGitRepo,
	deleteGitRepo,
	listGitTokens,
	mintGitToken,
	listTree,
	readFiles,
	readReadme,
	readRootEntries,
	gitRepoNameFor,
	resolveTag,
	revokeAllGitTokens,
	revokeGitToken,
} from "../artifacts/git.ts";
import { purgeRepoPage } from "../routes/seo.ts";
import { entitled } from "../payments/routes.ts";
import { copyGraph, recordGraph } from "../graph/store.ts";
import { canEdit, canView, isOwner } from "./access.ts";
import { CONTRACT_FILES, buildRepoMap, checkPwa, checkTemplate, pwaManifestCandidates, wranglerMain } from "@appmarket/template-contract";
import { storeLanguages } from "./languages.ts";
import { CheckStore } from "../checks/store.ts";
import { startChecks } from "../checks/start.ts";
import { copyNotes } from "../memory/store.ts";
import { startUpstreamSync } from "../sync/start.ts";
import { type RepoCheckSummary, RepoStore } from "./repository.ts";
import { checkRuntime } from "./runtime-check.ts";
import { detectAtHead, runtimeAt, saveRuntime } from "./detect.ts";
import { Screenshots } from "./screenshots.ts";
import { TokenAudit } from "./token-audit.ts";
import { tokenPolicy } from "./token-policy.ts";
import { publicRemote } from "../git/remote.ts";
import { logEvent } from "../observability/log.ts";
import { OwnerStore } from "../owners/store.ts";

const repos = () => new RepoStore(env.DB);
const tokenAudit = () => new TokenAudit(env.DB);
const screenshots = () => new Screenshots(env.DB, env.MEDIA);

type Ctx = { Variables: AuthVariables };
const perUser = (c: Context<Ctx>) => c.get("session")!.user.id;
const limitRepoCreate = strictLimit<Ctx>("REPO_CREATE", perUser);
const limitTokens = strictLimit<Ctx>("TOKENS", perUser);

function invalid(error: z.ZodError) {
	return { error: "invalid", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** PRD R1: catalog. Public reads see published repos; owners and admins see their own in any state. */
export const repoRoutes = new Hono<{ Variables: AuthVariables }>()
	.get("/", async (c) => {
		const search = repoSearchSchema.safeParse(c.req.query());
		if (!search.success) return c.json(invalid(search.error), 400);
		return c.json(await repos().search(search.data));
	})
	// The user's repos and their organizations' repos (#102).
	.get("/mine", requireRole(), async (c) => {
		const session = c.get("session")!;
		return c.json({ items: await repos().listByOwners([session.user.id, ...session.orgIds]) });
	})
	.get("/:owner/:slug", async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		// SEO: a removed repo is gone for good, so crawlers drop it (410), unlike a hidden one (404).
		if (repo?.state === "removed" && !canEdit(repo, c.get("session"))) return c.json({ error: "gone" }, 410);
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json(repo);
	})
	.post("/", requireRole(), limitRepoCreate, async (c) => {
		const input = repoInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json(invalid(input.error), 400);
		const session = c.get("session")!;
		const user = session.user;
		// #102: create it under the user, or under an organization the user belongs to.
		const owners = new OwnerStore(env.DB);
		const self = await owners.forUser(user);
		const owner = !input.data.owner || input.data.owner === self.handle ? self : await owners.byHandle(input.data.owner);
		if (!owner || (owner.id !== self.id && !session.orgIds.includes(owner.id))) return c.json({ error: "invalid", issues: [{ path: "owner", message: "You can create repos for yourself or an organization you belong to." }] }, 400);
		// PRD R19: per-developer quota on repos that are not removed. Admins are exempt.
		if (user.role !== "admin" && (await repos().countActiveByCreator(user.id)) >= MAX_REPOS_PER_DEVELOPER) {
			return c.json({ error: "quota_exceeded", limit: MAX_REPOS_PER_DEVELOPER }, 409);
		}
		// Creating a first repo makes a buyer a developer (PRD R11 roles).
		if (user.role === "buyer") {
			await env.DB.prepare(`UPDATE "user" SET role = 'developer' WHERE id = ? AND role = 'buyer'`).bind(user.id).run();
		}
		// PRD R2: create the repo's Artifacts repo first; undo it if the repo cannot be saved.
		const store = repos();
		const ids = await store.reserve(owner.id, input.data.name);
		const gitRepo = gitRepoNameFor(ids.slug, ids.id);
		if (input.data.importUrl) {
			// #30: start from a public GitHub repository.
			try {
				await importGitRepo(gitRepo, input.data.importUrl, input.data.importBranch);
			} catch (error) {
				const code = `${(error as { code?: string }).code ?? ""} ${error instanceof Error ? error.message : String(error)}`;
				// GitHub answers 401 for missing repositories too, so "missing" and "private" read the same.
				const message = /REMOTE_AUTH_REQUIRED|requires authentication/i.test(code)
					? "That repository does not exist or is private; only public GitHub repositories can be imported."
					: /Branch not found/i.test(code)
						? `That repository has no branch ${input.data.importBranch ?? ""}.`.replace(" .", ".")
						: /NOT_FOUND|INVALID_URL/.test(code)
							? "Could not find that repository on GitHub."
							: /MEMORY_LIMIT/.test(code)
								? "That repository is too large to import."
								: "GitHub could not be reached; try again.";
				logEvent("repo.import_failed", { url: input.data.importUrl, reason: code.slice(0, 300) }, "warn");
				return c.json({ error: "import_failed", message, issues: [{ path: "importUrl", message }] }, 422);
			}
		} else {
			await createGitRepo(gitRepo);
		}
		try {
			const created = await store.insert(ids, owner.id, user.id, input.data, gitRepo);
			if (input.data.importUrl) await store.setImportedFrom(created.id, `${input.data.importUrl.replace(/(\.git)?\/?$/, "")}${input.data.importBranch ? `#${input.data.importBranch}` : ""}`);
			// Imported code is there already: detect its runtime now.
			if (input.data.importUrl) await detectAtHead(created.id, gitRepo).catch(() => null);
			logEvent("repo.created", { repo: created.fullName, gitRepo: gitRepo, user: user.id, imported: !!input.data.importUrl });
			return c.json(await store.findById(created.id), 201);
		} catch (error) {
			await deleteGitRepo(gitRepo).catch(() => undefined);
			if (String(error).includes("UNIQUE")) return c.json({ error: "conflict", message: "Name just taken; retry." }, 409);
			throw error;
		}
	})
	// #27: the latest check runs (owners, org members and admins).
	.get("/:owner/:slug/checks", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || (!canEdit(repo, session) && session.user.role !== "admin")) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await new CheckStore(env.DB).recent(repo.id) });
	})
	// #26 (R6): "use this template": fork a published free app into a repo of your own.
	.post("/:owner/:slug/fork", requireRole(), limitRepoCreate, async (c) => {
		const store = repos();
		const source = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!source || source.state !== "published" || !source.gitRepo) return c.json({ error: "not_found" }, 404);
		// Paid apps need an entitlement first (R17, #42).
		if (!(await entitled(source, c.get("session")))) return c.json({ error: "paid", message: "Buy this app to use it as a template." }, 402);
		const body = ((await c.req.json().catch(() => ({}))) as { owner?: unknown; name?: unknown; copyMemory?: unknown }) ?? {};
		const session = c.get("session")!;
		const user = session.user;
		const owners = new OwnerStore(env.DB);
		const self = await owners.forUser(user);
		const ownerHandle = typeof body.owner === "string" && body.owner.trim() ? body.owner.trim().toLowerCase() : self.handle;
		const owner = ownerHandle === self.handle ? self : await owners.byHandle(ownerHandle);
		if (!owner || (owner.id !== self.id && !session.orgIds.includes(owner.id))) return c.json({ error: "invalid", issues: [{ path: "owner", message: "Fork into your account or an organization you belong to." }] }, 400);
		if (user.role !== "admin" && (await store.countActiveByCreator(user.id)) >= MAX_REPOS_PER_DEVELOPER) {
			return c.json({ error: "quota_exceeded", limit: MAX_REPOS_PER_DEVELOPER }, 409);
		}
		const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : source.name;
		if (user.role === "buyer") await env.DB.prepare(`UPDATE "user" SET role = 'developer' WHERE id = ? AND role = 'buyer'`).bind(user.id).run();
		const ids = await store.reserve(owner.id, name);
		const gitRepo = gitRepoNameFor(ids.slug, ids.id);
		await forkGitRepo(source.gitRepo, gitRepo);
		try {
			const input = repoInputSchema.parse({ name, summary: source.summary, description: source.description, category: source.category, runtime: source.runtime, platforms: source.platforms, license: source.license });
			const created = await store.insert(ids, owner.id, user.id, input, gitRepo);
			await store.setForkedFrom(created.id, source);
			// #67: the fork starts with its source's graph edges.
			await copyGraph(source.id, created.id);
			// #198: and, if asked, its memory (all notes for the source's own people, public ones otherwise).
			if (body.copyMemory === true) await copyNotes(source.id, created.id, canEdit(source, session), user.id).catch((e: unknown) => logEvent("memory.copy_failed", { repo: created.fullName, error: String(e) }, "warn"));
			if (source.runtimeDetected) await saveRuntime(created.id, source.runtime);
			logEvent("repo.forked", { repo: created.fullName, from: source.fullName, tag: source.publishedTag, user: user.id });
			return c.json(await store.findById(created.id), 201);
		} catch (error) {
			await deleteGitRepo(gitRepo).catch(() => undefined);
			if (String(error).includes("UNIQUE")) return c.json({ error: "conflict", message: "Name just taken; retry." }, 409);
			throw error;
		}
	})
	.patch("/:owner/:slug", requireRole(), async (c) => {
		const store = repos();
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		if (!canEdit(repo, session)) return c.json({ error: "forbidden" }, 403);
		if (repo.state === "removed") return c.json({ error: "removed" }, 409);
		const update = repoUpdateSchema.safeParse(await c.req.json().catch(() => null));
		if (!update.success) return c.json(invalid(update.error), 400);
		await store.update(repo.id, update.data);
		if (repo.state === "published") c.executionCtx.waitUntil(purgeRepoPage(repo.fullName));
		return c.json(await store.findById(repo.id));
	})
	// PRD R12: lifecycle. Owners submit a tag, withdraw, unpublish or remove; admins publish (approve).
	// #33 (M2): the developer declares the app's Android package and that its developer verification is done.
	.put("/:owner/:slug/android", requireRole(), async (c) => {
		const store = repos();
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const body = (await c.req.json().catch(() => null)) as { package?: unknown; verified?: unknown } | null;
		if (body?.package === null) {
			await store.setAndroid(repo.id, null);
			return c.json(await store.findById(repo.id));
		}
		if (typeof body?.package !== "string" || !ANDROID_PACKAGE.test(body.package) || body.package.length > 150) return c.json({ error: "invalid", issues: [{ path: "package", message: "Use an Android application ID such as com.example.notes." }] }, 400);
		if (body.verified !== true) return c.json({ error: "invalid", issues: [{ path: "verified", message: "Confirm that you completed Android developer verification for this package." }] }, 400);
		await store.setAndroid(repo.id, body.package);
		logEvent("android.declared", { repo: repo.fullName, package: body.package, user: c.get("session")!.user.id });
		if (repo.state === "published") c.executionCtx.waitUntil(purgeRepoPage(repo.fullName));
		return c.json(await store.findById(repo.id));
	})
	.post("/:owner/:slug/transitions", requireRole(), async (c) => {
		const store = repos();
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		const request = transitionSchema.safeParse(await c.req.json().catch(() => null));
		if (!request.success) return c.json(invalid(request.error), 400);
		// #29: an agent session's fork is a workspace; its work reaches the marketplace through the repo it came from.
		if (repo.sessionOf && request.data.to !== "removed") return c.json({ error: "session_fork", message: "Merge the session's work into the repo it came from and submit that." }, 409);
		const actor = actorFor(repo, session, request.data.to);
		if (!actor) {
			return c.json({ error: "transition_not_allowed", from: repo.state, to: request.data.to }, canEdit(repo, session) ? 409 : 403);
		}
		// An update to a published app can be published or sent back only while it is pending.
		if (repo.state === "published" && (request.data.to === "published" || request.data.to === "draft") && !repo.submittedTag) {
			return c.json({ error: "no_update", message: "No update is waiting for review." }, 409);
		}
		// R18: an admin sending a submission back must say what to change.
		if (request.data.to === "draft" && actor === "admin" && !request.data.note) {
			return c.json({ error: "note_required", message: "Tell the owner what to change." }, 400);
		}
		// PRD R2: a submitted tag must exist in the repo's Git repository; record the commit it points to.
		let commit: string | null = null;
		let checks: RepoCheckSummary | null = null;
		if (request.data.to === "submitted") {
			if (!repo.gitRepo) return c.json({ error: "no_repo" }, 409);
			commit = await resolveTag(repo.gitRepo, request.data.tag);
			if (!commit) return c.json({ error: "tag_not_found", tag: request.data.tag }, 422);
			// R26: the version must look like the declared runtime.
			// The runtime is read from the submitted code, not chosen by hand.
			const detected = await runtimeAt(repo.gitRepo, commit);
			if (!detected) return c.json({ error: "runtime_unknown", message: "Could not tell how this app runs. Add a Wrangler config with the Worker entry (or an index.html for a static site)." }, 422);
			if (detected !== repo.runtime || !repo.runtimeDetected) {
				await saveRuntime(repo.id, detected);
				repo.runtime = detected;
			}
			const root = await readRootEntries(repo.gitRepo, commit);
			const issues = checkRuntime(repo.runtime, root);
			if (issues.length > 0) return c.json({ error: "runtime_mismatch", runtime: repo.runtime, issues }, 422);
			// D2/G4: template contract; errors block, warnings and the D3 manifest go to review.
			const contract = checkTemplate({ runtime: repo.runtime, rootEntries: root.map((e) => e.name), files: await readFiles(repo.gitRepo, commit, CONTRACT_FILES) });
			if (contract.errors.length > 0) return c.json({ error: "contract_failed", errors: contract.errors, warnings: contract.warnings }, 422);
			// #32: installability as a web app, shown to reviewers and on the app page; never blocks.
			const paths = (await listTree(repo.gitRepo, commit)).filter((e) => e.type === "blob").map((e) => e.path);
			const pwa = checkPwa(paths, await readFiles(repo.gitRepo, commit, [...pwaManifestCandidates(paths), "package.json"]));
			checks = { warnings: contract.warnings, manifest: contract.manifest, pwa };
		}
		// #27: a submitted version publishes only when the automated checks of its commit passed.
		if (request.data.to === "published" && repo.submittedCommit) {
			const run = await new CheckStore(env.DB).latestFor(repo.id, repo.submittedCommit);
			if (!run || run.status === "queued" || run.status === "running") return c.json({ error: "checks_pending", message: "The checks for this version are still running." }, 409);
			if (run.status !== "passed") return c.json({ error: "checks_failed", message: "The checks for this version failed; send it back to the owner." }, 422);
		}
		if (!(await store.transition(repo, request.data, { id: session.user.id, role: actor }, commit, checks))) {
			return c.json({ error: "conflict", message: "Repo changed; reload and retry." }, 409);
		}
		logEvent("repo.transition", { repo: repo.fullName, from: repo.state, to: request.data.to, actor });
		// #27: run the checks on the submitted version (review waits for them).
		if (request.data.to === "submitted" && commit) c.executionCtx.waitUntil(startChecks(repo, commit, "submit", `refs/tags/${request.data.tag}`).catch((e) => logEvent("checks.start_failed", { repo: repo.fullName, error: e }, "error")));
		if (["published", "unpublished", "removed"].includes(request.data.to)) c.executionCtx.waitUntil(purgeRepoPage(repo.fullName));
		// G4: generate the repo map for the newly published version (stored beside it, not committed).
		if (request.data.to === "published" && repo.gitRepo && repo.submittedCommit) {
			c.executionCtx.waitUntil(storeRepoMap(repo, repo.submittedCommit).catch((e) => logEvent("repo_map.failed", { repo: repo.fullName, error: e }, "error")));
			// #67: graph edges of the newly published version.
			c.executionCtx.waitUntil(recordGraph(repo.id, repo.gitRepo!, repo.submittedCommit, repo.submittedChecks?.manifest ?? null).catch((e) => logEvent("graph.failed", { repo: repo.fullName, error: String(e) }, "warn")));
			// #170: language breakdown of the published version.
			c.executionCtx.waitUntil(storeLanguages(repo.id, repo.gitRepo, repo.submittedCommit).catch((e) => logEvent("languages.failed", { repo: repo.fullName, error: e }, "error")));
			// #73: forks that opted in get a pull request with the new version.
			if (repo.submittedTag) c.executionCtx.waitUntil(startUpstreamSync(repo, repo.submittedTag, repo.submittedCommit).catch((e) => logEvent("sync.start_failed", { repo: repo.fullName, error: String(e) }, "error")));
		}
		// PRD R19: archiving a removed repo revokes every active token; no new ones are issued (token policy).
		if (request.data.to === "removed" && repo.gitRepo) {
			await tokenAudit().recordRevocations(repo.id, await revokeAllGitTokens(repo.gitRepo), session.user.id);
		}
		return c.json(await store.findById(repo.id));
	})
	// PRD R3: short-lived, repo-scoped Git tokens. Write for the owner only; read once published.
	.post("/:owner/:slug/tokens", requireRole(), limitTokens, async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const user = c.get("session")!.user;
		if (!repo) return c.json({ error: "not_found" }, 404);
		const request = tokenRequestSchema.safeParse(await c.req.json().catch(() => ({})));
		if (!request.success) return c.json(invalid(request.error), 400);
		const decision = tokenPolicy(repo, { id: user.id, role: user.role as Role, orgIds: c.get("session")!.orgIds }, request.data.scope);
		if (!decision.allowed) return c.json({ error: decision.error }, decision.status);

		const ttl = request.data.ttl ?? TOKEN_TTL.default;
		const { id: tokenId, ...minted } = await mintGitToken(repo.gitRepo!, request.data.scope, ttl);
		// R19: audit every mint with the token id, never the token itself.
		await tokenAudit().recordMint({ repoId: repo.id, userId: user.id, tokenId, scope: request.data.scope, expiresAt: minted.expiresAt });
		logEvent("token.minted", { repo: repo.fullName, scope: request.data.scope, ttl, user: user.id, auditId: tokenId });
		c.header("Cache-Control", "no-store");
		return c.json({ scope: request.data.scope, ...minted, remote: publicRemote(repo.fullName) } satisfies GitToken, 201);
	})
	// PRD R19: owners and admins see every token minted for the repo and can revoke them.
	.get("/:owner/:slug/tokens", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const live = repo.gitRepo ? await listGitTokens(repo.gitRepo) : [];
		return c.json({ items: await tokenAudit().list(repo.id, live) });
	})
	.delete("/:owner/:slug/tokens/:tokenId", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canEdit(repo, session) || !repo.gitRepo) return c.json({ error: "not_found" }, 404);
		const tokenId = c.req.param("tokenId");
		// Only tokens appmarket.org minted for this repo can be revoked through it.
		if (!(await tokenAudit().isAudited(repo.id, tokenId))) return c.json({ error: "not_found" }, 404);
		const revoked = await revokeGitToken(repo.gitRepo, tokenId);
		await tokenAudit().recordRevocations(repo.id, [tokenId], session.user.id);
		return c.json({ revoked });
	})
	.post("/:owner/:slug/tokens/revoke-all", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canEdit(repo, session) || !repo.gitRepo) return c.json({ error: "not_found" }, 404);
		const ids = await revokeAllGitTokens(repo.gitRepo);
		await tokenAudit().recordRevocations(repo.id, ids, session.user.id);
		return c.json({ revoked: ids.length });
	})
	// G4: orientation map of the published version for agents (Markdown).
	.get("/:owner/:slug/repo-map", async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const row = await env.DB.prepare("SELECT published_repo_map FROM repos WHERE id = ?").bind(repo.id).first<{ published_repo_map: string | null }>();
		if (!row?.published_repo_map) return c.json({ error: "no_map" }, 404);
		return c.body(row.published_repo_map, 200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": repo.state === "published" ? "public, max-age=300" : "private, no-store" });
	})
	// R16: Git remote for the owner's dashboard (no credentials in it).
	.get("/:owner/:slug/git", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		if (!repo.gitRepo) return c.json({ error: "no_repo" }, 409);
		return c.json({ name: repo.gitRepo, remote: publicRemote(repo.fullName) });
	})
	// R24: changelog (published versions) and README of the published commit.
	.get("/:owner/:slug/versions", async (c) => {
		const store = repos();
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await store.versions(repo.id) });
	})
	.get("/:owner/:slug/readme", async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session");
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		// Buyers see the published commit; the owner and admins can preview the submitted one.
		const commit = c.req.query("version") === "submitted" && canEdit(repo, session) ? repo.submittedCommit : repo.publishedCommit;
		const markdown = repo.gitRepo && commit ? await readReadme(repo.gitRepo, commit) : null;
		if (markdown === null) return c.json({ error: "no_readme" }, 404);
		c.header("Cache-Control", repo.state === "published" ? "public, max-age=300" : "private, no-store");
		return c.json({ commit, markdown });
	})
	// R24: screenshots (owner manages; visible wherever the repo is).
	.get("/:owner/:slug/screenshots", async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await screenshots().list(repo.id) });
	})
	.post("/:owner/:slug/screenshots", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		if (!canEdit(repo, session)) return c.json({ error: "forbidden" }, 403);
		const declared = Number(c.req.header("content-length") ?? "0");
		if (declared > SCREENSHOT_LIMITS.maxBytes) return c.json({ error: "too_large", maxBytes: SCREENSHOT_LIMITS.maxBytes }, 413);
		const result = await screenshots().add(repo.id, await c.req.arrayBuffer());
		if (result.ok && repo.state === "published") c.executionCtx.waitUntil(purgeRepoPage(repo.fullName));
		return result.ok ? c.json(result.screenshot, 201) : c.json({ error: result.error }, result.status);
	})
	.delete("/:owner/:slug/screenshots/:id", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canEdit(repo, session)) return c.json({ error: "not_found" }, 404);
		return (await screenshots().remove(repo.id, c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	})
	.get("/:owner/:slug/events", requireRole(), async (c) => {
		const store = repos();
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canEdit(repo, session)) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await store.events(repo.id) });
	});

/** PRD R18: moderation queue. Mounted under /api/admin. */
export const adminRepoRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireRole("admin"))
	.get("/repos", async (c) => {
		const state = c.req.query("state") ?? "submitted";
		if (!["draft", "submitted", "published", "unpublished", "removed"].includes(state)) return c.json({ error: "invalid_state" }, 400);
		return c.json({ items: await repos().listByState(state as Repo["state"]) });
	});

type SessionLike = AuthVariables["session"];

/** The role this user acts in for a transition, or null if they may not make it. Owners act as owners first. */
function actorFor(repo: Repo, session: NonNullable<SessionLike>, to: Repo["state"]): TransitionActor | null {
	const roles: TransitionActor[] = [];
	if (isOwner(repo, { id: session.user.id, orgIds: session.orgIds })) roles.push("owner");
	if (session.user.role === "admin") roles.push("admin");
	return roles.find((role) => canTransition(repo.state, to, role)) ?? null;
}


/** R24: serves screenshot bytes. Mounted at /api/media. Unpublished repos' images stay private. */
export const mediaRoutes = new Hono<{ Variables: AuthVariables }>().get("/screenshots/:id", async (c) => {
	const store = screenshots();
	const row = await store.find(c.req.param("id"));
	const repo = row && (await repos().findById(row.repo_id));
	if (!row || !repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
	const object = await store.object(row);
	if (!object) return c.json({ error: "not_found" }, 404);
	return c.body(object.body, 200, {
		"Content-Type": row.content_type,
		"Cache-Control": repo.state === "published" ? "public, max-age=86400" : "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'",
	});
});

/** G4: builds the repo map for a published commit and stores it, unless a newer version was published meanwhile. */
async function storeRepoMap(repo: Repo, commit: string): Promise<void> {
	const [entries, files] = await Promise.all([listTree(repo.gitRepo!, commit), readFiles(repo.gitRepo!, commit, CONTRACT_FILES)]);
	const map = buildRepoMap({
		repoName: repo.name,
		tag: repo.submittedTag ?? "",
		commit,
		entries,
		packageJson: files.get("package.json"),
		wranglerMain: wranglerMain(files),
		manifest: repo.submittedChecks?.manifest ?? null,
		hasAgentsMd: files.has("AGENTS.md"),
	});
	await env.DB.prepare("UPDATE repos SET published_repo_map = ? WHERE id = ? AND published_commit = ?").bind(map, repo.id, commit).run();
}
