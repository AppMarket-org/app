// Offline config for `pnpm db:auth-schema`: same options as production, in-memory SQLite, dummy secrets.
// Better Auth's CLI reads the schema from it and writes SQL for D1. Never used at runtime.
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { authOptions } from "../src/auth/options.ts";

const placeholder = { clientId: "schema-only", clientSecret: "schema-only" };

export const auth = betterAuth(
	authOptions(new Database(":memory:"), {
		baseURL: "http://localhost:4200",
		secret: "schema-generation-only-not-a-real-secret",
		google: placeholder,
		github: placeholder,
		turnstileSecretKey: "schema-only",
	}),
);
