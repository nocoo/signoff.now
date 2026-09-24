// Resolves the caller once per request. Route policy (route-policy.ts) and
// handlers read the result instead of inspecting hosts or headers themselves.

import {
	emailPrincipal,
	type Principal,
	parseAdminPrincipals,
	selectTenant,
	servicePrincipal,
	type TenantSummary,
} from "@signoff/domain/principal";
import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";
import { hasLocalTrust, isMachineEndpoint } from "./entry-control.js";

export type Caller =
	| { kind: "local" }
	| {
			kind: "person" | "service";
			principal: Principal;
			admin: boolean;
			tenants: TenantSummary[];
			tenantId: string | null;
	  }
	| { kind: "machine" }
	| { kind: "anonymous" };

export const TENANT_HEADER = "x-signoff-tenant";

export async function readAdmin(
	db: D1Database,
	env: AppEnv["Bindings"],
	principal: Principal,
): Promise<boolean> {
	if (parseAdminPrincipals(env.SIGNOFF_ADMIN_EMAILS).has(principal))
		return true;
	return Boolean(
		await db
			.prepare("SELECT 1 AS ok FROM admins WHERE principal=?")
			.bind(principal)
			.first(),
	);
}

async function readTenants(
	db: D1Database,
	principal: Principal,
	admin: boolean,
): Promise<TenantSummary[]> {
	const rows = await db
		.prepare(
			admin
				? "SELECT id,name FROM tenants ORDER BY name COLLATE NOCASE,id"
				: `SELECT t.id,t.name FROM tenants t JOIN tenant_members m ON m.tenant_id=t.id
          WHERE m.principal=? ORDER BY t.name COLLATE NOCASE,t.id`,
		)
		.bind(...(admin ? [] : [principal]))
		.all<TenantSummary>();
	return rows.results;
}

export async function resolvePrincipal(c: Context<AppEnv>, next: Next) {
	if (hasLocalTrust(c)) {
		c.set("caller", { kind: "local" });
		return next();
	}
	if (isMachineEndpoint(c.req.header("host") ?? "")) {
		c.set("caller", { kind: "machine" });
		return next();
	}
	if (c.get("accessAuthenticated") !== true) {
		c.set("caller", { kind: "anonymous" });
		return next();
	}
	const service = c.get("accessService") === true;
	const identity = service ? c.get("accessName") : c.get("accessEmail");
	if (!identity) {
		c.set("caller", { kind: "anonymous" });
		return next();
	}
	const principal = service
		? servicePrincipal(identity)
		: emailPrincipal(identity);
	const admin = await readAdmin(c.env.DB, c.env, principal);
	const tenants = await readTenants(c.env.DB, principal, admin);
	c.set("caller", {
		kind: service ? "service" : "person",
		principal,
		admin,
		tenants,
		tenantId: selectTenant(c.req.header(TENANT_HEADER), tenants),
	});
	return next();
}
