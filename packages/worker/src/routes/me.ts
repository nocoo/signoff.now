import type { Context } from "hono";
import type { AppEnv } from "../types.js";

export function meRoute(c: Context<AppEnv>) {
	if (c.get("accessAuthenticated") === true) {
		return c.json({
			email: c.get("accessEmail") ?? null,
			name: c.get("accessName") ?? null,
			authenticated: true,
		});
	}

	// Localhost / no JWT: anonymous for sidebar
	return c.json({
		email: null,
		name: null,
		authenticated: false,
	});
}
