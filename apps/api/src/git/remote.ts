import { env } from "cloudflare:workers";

/** The repo's Git remote as people and agents see it: appmarket.org/<owner>/<repo>.git (see git/proxy.ts). */
export const publicRemote = (fullName: string) => `${env.PUBLIC_ORIGIN}/${fullName}.git`;
