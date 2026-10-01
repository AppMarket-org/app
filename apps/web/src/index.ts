import { createRepo } from "./routes/repos.ts";

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/repos") {
			return createRepo(request);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;
