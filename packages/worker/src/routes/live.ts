import type { Context } from "hono";
import type { AppEnv } from "../types.js";

export function liveRoute(c: Context<AppEnv>) {
	return c.json({ ok: true, service: "signoff" });
}
