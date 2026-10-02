import { createRepo } from "./routes/repos.ts";
import { createToken } from "./routes/tokens.ts";

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/repos") {
			return createRepo(request);
		}

		const tokenRoute = url.pathname.match(/^\/repos\/([A-Za-z0-9][A-Za-z0-9._-]*)\/tokens$/);
		if (request.method === "POST" && tokenRoute) {
			return createToken(request, tokenRoute[1]);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;
