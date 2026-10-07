import { describe, expect, it } from "vitest";
import { appUrl, type Deployment, runningApps } from "./deployments";

const d = (id: string, at: string, status: Deployment["status"], workerName = "bombfind", accountId = "acct"): Deployment => ({
	id,
	repoFullName: "cport1/bombfind",
	repoName: "BombFind",
	versionTag: "",
	accountId,
	workerName,
	previewBranch: "main",
	status,
	url: null,
	domains: [],
	error: null,
	createdAt: at,
	updatedAt: at,
});

describe("runningApps (#307)", () => {
	it("is one app per Worker and account, live from its latest successful deployment", () => {
		const apps = runningApps([d("1", "2026-10-05T17:24", "failed"), d("2", "2026-10-05T18:04", "succeeded"), d("3", "2026-10-05T21:07", "succeeded"), d("4", "2026-10-05T21:30", "failed")]);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({ workerName: "bombfind", deployments: 4 });
		expect(apps[0]!.live!.id).toBe("3");
		expect(apps[0]!.latest.id).toBe("4");
	});

	it("keeps other Workers and accounts apart, newest first", () => {
		const apps = runningApps([d("1", "2026-10-01", "succeeded"), d("2", "2026-10-02", "failed", "other"), d("3", "2026-10-03", "succeeded", "bombfind", "acct2")]);
		expect(apps.map((a) => a.key)).toEqual(["acct2/bombfind", "acct/other", "acct/bombfind"]);
		expect(apps[1]!.live).toBeNull();
	});
});

describe("appUrl", () => {
	const url = "https://bombfind.cport1.workers.dev";
	it("is the custom domain when there is one: the apex first, then www, then other subdomains", () => {
		expect(appUrl({ url, domains: [] })).toBe(url);
		expect(appUrl({ url, domains: ["www.bombfind.com", "bombfind.com"] })).toBe("https://bombfind.com");
		expect(appUrl({ url, domains: ["play.bombfind.com", "www.bombfind.com"] })).toBe("https://www.bombfind.com");
		expect(appUrl({ url, domains: ["beta.games.example", "app.example"] })).toBe("https://app.example");
		expect(appUrl({ url, domains: ["www.hello.example.com", "hello.example.com"] })).toBe("https://hello.example.com");
		expect(appUrl({ url: null, domains: [] })).toBeNull();
	});
});
