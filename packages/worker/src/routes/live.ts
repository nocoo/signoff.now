import type { Context } from "hono";
import { version } from "../../../../package.json";
import type { AppEnv } from "../types.js";

export async function liveRoute(c: Context<AppEnv>) {
	let connected = false;
	try {
		const row = await c.env.DB.prepare("SELECT 1 AS healthy").first<{
			healthy: number;
		}>();
		connected = row?.healthy === 1;
	} catch {
		connected = false;
	}
	return c.json(
		{
			ok: connected,
			service: "signoff",
			status: connected ? "ok" : "error",
			version,
			database: { connected },
		},
		connected ? 200 : 503,
		{ "Cache-Control": "no-store" },
	);
}
