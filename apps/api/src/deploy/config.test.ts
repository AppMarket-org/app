import { describe, expect, it, vi } from "vitest";
import { bindingsWith, readConfig, writeSecret, writeVar } from "./config";

const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
const bindings = [
	{ name: "DB", type: "d1" },
	{ name: "GREETING", type: "plain_text", text: "Hello" },
	{ name: "API_KEY", type: "secret_text" },
];

describe("Worker variables and secrets (#51)", () => {
	it("lists variables with values and secrets by name only", async () => {
		const fetcher = vi.fn(async () => ok({ bindings }));
		expect(await readConfig(fetcher as unknown as typeof fetch, "t", "acct", "w")).toEqual({ vars: [{ name: "GREETING", value: "Hello" }], secrets: ["API_KEY"] });
	});

	it("inherits every other binding when one variable changes or goes", () => {
		expect(bindingsWith(bindings, "GREETING", "Hi")).toEqual([
			{ name: "DB", type: "inherit" },
			{ name: "API_KEY", type: "inherit" },
			{ name: "GREETING", type: "plain_text", text: "Hi" },
		]);
		expect(bindingsWith(bindings, "GREETING", null).map((b) => b.name)).toEqual(["DB", "API_KEY"]);
	});

	it("patches settings as multipart and sends secrets to the secrets API", async () => {
		const calls: [string, RequestInit][] = [];
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push([url, init ?? {}]);
			return ok(init?.method ? {} : { bindings });
		});
		await writeVar(fetcher as unknown as typeof fetch, "t", "acct", "w", "NEW", "1");
		const [patchUrl, patch] = calls[1]!;
		expect(patchUrl).toMatch(/\/workers\/scripts\/w\/settings$/);
		expect(patch.method).toBe("PATCH");
		const settings = JSON.parse(await ((patch.body as FormData).get("settings") as Blob).text());
		expect(settings.bindings).toContainEqual({ name: "NEW", type: "plain_text", text: "1" });
		await writeSecret(fetcher as unknown as typeof fetch, "t", "acct", "w", "API_KEY", "s3cret");
		expect(calls[2]![0]).toMatch(/\/secrets$/);
		expect(JSON.parse(String(calls[2]![1].body))).toEqual({ name: "API_KEY", text: "s3cret", type: "secret_text" });
		await writeSecret(fetcher as unknown as typeof fetch, "t", "acct", "w", "API_KEY", null);
		expect(calls[3]![0]).toMatch(/\/secrets\/API_KEY$/);
		expect(calls[3]![1].method).toBe("DELETE");
	});
});
