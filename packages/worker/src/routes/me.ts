import type { Context } from "hono";
import type { AppEnv } from "../types.js";

export function meRoute(c: Context<AppEnv>) {
	if (c.get("accessAuthenticated") === true) {
		return c.json({
			email: c.get("accessEmail") ?? null,
			name: c.get("accessName") ?? null,
			// A service token has no email; the sidebar shows its Client ID as
			// the name so an automated session is never mistaken for a person's.
			service: c.get("accessService") === true,
			authenticated: true,
		});
	}

	// Localhost / no JWT: anonymous for sidebar
	return c.json({
		email: null,
		name: null,
		service: false,
		authenticated: false,
	});
}
