import {
	adminMemberWriteSchema,
	memberPrincipal,
	type Principal,
	parseAdminPrincipals,
	principalSchema,
} from "@signoff/domain/principal";
import { type Context, Hono } from "hono";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.onError((error, c) => apiError(error, c));
adminRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});

const now = () => Math.floor(Date.now() / 1000);

/** Audit column value: the acting principal, or `local` for trusted loopback. */
function actor(c: Context<AppEnv>): string {
	const caller = c.get("caller");
	return caller && (caller.kind === "person" || caller.kind === "service")
		? caller.principal
		: "local";
}

async function member(c: Context<AppEnv>): Promise<Principal> {
	const raw = await readJsonBodyWithSize(c, 2048);
	const input = adminMemberWriteSchema.safeParse(raw.ok ? raw.value : null);
	const principal = input.success ? memberPrincipal(input.data.member) : null;
	if (!principal)
		throw new MonitoringError(
			"INVALID_ARGUMENT",
			"Enter an email address or service:<client id>",
			400,
		);
	return principal;
}

function pathPrincipal(c: Context<AppEnv>): Principal {
	const parsed = principalSchema.safeParse(c.req.param("principal"));
	if (!parsed.success)
		throw new MonitoringError("INVALID_ARGUMENT", "Invalid principal", 400);
	return parsed.data;
}

type MemberRow = {
	tenant_id: string;
	principal: string;
	added_by: string;
	added_at: number;
};
type AdminRow = { principal: string; created_by: string; created_at: number };

adminRoutes.get("/directory", async (c) => {
	const [tenants, members, admins] = await c.env.DB.batch([
		c.env.DB.prepare(
			"SELECT id,name FROM tenants ORDER BY name COLLATE NOCASE,id",
		),
		c.env.DB.prepare(
			"SELECT tenant_id,principal,added_by,added_at FROM tenant_members ORDER BY principal",
		),
		c.env.DB.prepare(
			"SELECT principal,created_by,created_at FROM admins ORDER BY principal",
		),
	]);
	const memberRows = (members?.results ?? []) as MemberRow[];
	const environment = parseAdminPrincipals(c.env.SIGNOFF_ADMIN_EMAILS);
	const stored = ((admins?.results ?? []) as AdminRow[]).filter(
		(row) => !environment.has(row.principal),
	);
	return c.json({
		tenants: ((tenants?.results ?? []) as { id: string; name: string }[]).map(
			(tenant) => ({
				...tenant,
				members: memberRows
					.filter((row) => row.tenant_id === tenant.id)
					.map((row) => ({
						principal: row.principal,
						addedBy: row.added_by,
						addedAt: row.added_at,
					})),
			}),
		),
		admins: [
			...[...environment].sort().map((principal) => ({
				principal,
				source: "environment" as const,
				createdBy: null,
				createdAt: null,
			})),
			...stored.map((row) => ({
				principal: row.principal,
				source: "database" as const,
				createdBy: row.created_by,
				createdAt: row.created_at,
			})),
		],
	});
});

adminRoutes.post("/tenants/:id/members", async (c) => {
	const principal = await member(c);
	const tenantId = c.req.param("id");
	const result = await c.env.DB.prepare(
		`INSERT INTO tenant_members(tenant_id,principal,added_by,added_at)
      SELECT id,?,?,? FROM tenants WHERE id=?
      ON CONFLICT(tenant_id,principal) DO NOTHING`,
	)
		.bind(principal, actor(c), now(), tenantId)
		.run();
	if (!result.meta.changes) {
		const tenant = await c.env.DB.prepare(
			"SELECT 1 AS ok FROM tenants WHERE id=?",
		)
			.bind(tenantId)
			.first();
		if (!tenant)
			throw new MonitoringError("NOT_FOUND", "Tenant not found", 404);
		return c.json({ status: "already_member", principal });
	}
	return c.json({ status: "added", principal }, 201);
});

adminRoutes.delete("/tenants/:id/members/:principal", async (c) => {
	const result = await c.env.DB.prepare(
		"DELETE FROM tenant_members WHERE tenant_id=? AND principal=?",
	)
		.bind(c.req.param("id"), pathPrincipal(c))
		.run();
	return c.json({ status: result.meta.changes ? "removed" : "not_member" });
});

adminRoutes.post("/admins", async (c) => {
	const principal = await member(c);
	if (parseAdminPrincipals(c.env.SIGNOFF_ADMIN_EMAILS).has(principal))
		return c.json({ status: "environment_admin", principal });
	const result = await c.env.DB.prepare(
		"INSERT INTO admins(principal,created_by,created_at) VALUES(?,?,?) ON CONFLICT(principal) DO NOTHING",
	)
		.bind(principal, actor(c), now())
		.run();
	return result.meta.changes
		? c.json({ status: "added", principal }, 201)
		: c.json({ status: "already_admin", principal });
});

adminRoutes.delete("/admins/:principal", async (c) => {
	const principal = pathPrincipal(c);
	if (parseAdminPrincipals(c.env.SIGNOFF_ADMIN_EMAILS).has(principal))
		throw new MonitoringError(
			"ENVIRONMENT_ADMIN",
			"Environment administrators are managed through SIGNOFF_ADMIN_EMAILS",
			409,
		);
	const caller = c.get("caller");
	if (
		caller &&
		(caller.kind === "person" || caller.kind === "service") &&
		caller.principal === principal
	)
		throw new MonitoringError(
			"SELF_REMOVAL",
			"Another administrator must remove your access",
			409,
		);
	const result = await c.env.DB.prepare("DELETE FROM admins WHERE principal=?")
		.bind(principal)
		.run();
	return c.json({ status: result.meta.changes ? "removed" : "not_admin" });
});
