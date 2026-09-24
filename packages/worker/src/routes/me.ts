import type { Session } from "@signoff/domain/principal";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";

export function meRoute(c: Context<AppEnv>) {
	const caller = c.get("caller") ?? { kind: "anonymous" as const };
	const identified = caller.kind === "person" || caller.kind === "service";
	const session: Session = {
		authenticated: identified,
		local: caller.kind === "local",
		principal: identified ? caller.principal : null,
		email: caller.kind === "person" ? (c.get("accessEmail") ?? null) : null,
		// A service token has no email; the sidebar shows its Client ID as
		// the name so an automated session is never mistaken for a person's.
		name: identified ? (c.get("accessName") ?? null) : null,
		service: caller.kind === "service",
		admin: caller.kind === "local" || (identified && caller.admin),
		tenants: identified ? caller.tenants : [],
		tenantId: identified ? caller.tenantId : null,
	};
	c.header("Cache-Control", "no-store");
	return c.json(session);
}
