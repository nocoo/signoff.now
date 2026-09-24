import {
	CONNECTOR_ONLINE_SECONDS,
	type Connector,
	type ConnectorList,
	type ConnectorMe,
	connectorLoginSchema,
} from "@signoff/domain/connector";
import { type Principal, principalSchema } from "@signoff/domain/principal";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
	type ConnectorRow,
	issueConnector,
	mapConnector,
} from "../connectors/store.js";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import type { Caller } from "../middleware/principal.js";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

const now = () => Math.floor(Date.now() / 1000);

type Person = Extract<Caller, { kind: "person" | "service" }>;
function person(c: Context<AppEnv>): Person {
	const caller = c.get("caller");
	if (caller?.kind === "person" || caller?.kind === "service") return caller;
	throw new MonitoringError("FORBIDDEN", "Sign in to manage connectors", 403);
}

type OwnedRow = { id: string; name: string; organization: string };
type HeartbeatRow = {
	last_seen_at: number;
	state: "ready" | "auth_required" | "error";
	message: string;
};

/** The loopback daemon reports through collector_heartbeat, not a token. */
function localCollector(row: HeartbeatRow, timestamp: number): Connector {
	return {
		id: "local",
		owner: "local",
		name: "This machine",
		platform: "",
		version: "",
		createdAt: row.last_seen_at,
		expiresAt: 0,
		lastSeenAt: row.last_seen_at,
		state: row.state,
		message: row.message,
		capabilities: {},
		online: timestamp - row.last_seen_at <= CONNECTOR_ONLINE_SECONDS,
		revoked: false,
		local: true,
	};
}
function ownedProjects(
	db: D1Database,
	owner: string,
	tenantId?: string | null,
) {
	return db
		.prepare(
			`SELECT id,name,organization FROM projects WHERE data_owner=? AND source='cli'
       AND (? IS NULL OR tenant_id=?) ORDER BY name COLLATE NOCASE,id`,
		)
		.bind(owner, tenantId ?? null, tenantId ?? null);
}

/**
 * Browser half of connector sign-in (base-cli performLogin). The page runs
 * behind Access, so reaching it proves the person; the token goes only to the
 * loopback callback the CLI opened, with its state nonce echoed back.
 */
export const connectorLoginRoute = async (c: Context<AppEnv>) => {
	c.header("Cache-Control", "no-store");
	c.header("Referrer-Policy", "no-referrer");
	const input = connectorLoginSchema.safeParse(c.req.query());
	if (!input.success)
		return c.json(
			{ error: input.error.issues[0]?.message ?? "Invalid sign-in request" },
			400,
		);
	const caller = person(c);
	const issued = await issueConnector(
		c.env.DB,
		caller.principal,
		input.data,
		now(),
	);
	const callback = new URL(input.data.callback);
	callback.searchParams.set("state", input.data.state);
	callback.searchParams.set("api_key", issued.token);
	callback.searchParams.set("connector_id", issued.id);
	callback.searchParams.set("owner", caller.principal);
	callback.searchParams.set("expires_at", String(issued.expiresAt));
	if (caller.kind === "person") {
		const email = caller.principal.slice("email:".length);
		callback.searchParams.set("email", email);
	}
	return c.redirect(callback.toString(), 302);
};

export const connectorMeRoute = async (c: Context<AppEnv>) => {
	const caller = c.get("caller");
	if (caller?.kind !== "connector")
		throw new MonitoringError("FORBIDDEN", "Connector token required", 403);
	const [row, projects] = await c.env.DB.batch([
		c.env.DB.prepare("SELECT * FROM connectors WHERE id=?").bind(
			caller.connectorId,
		),
		ownedProjects(c.env.DB, caller.owner),
	]);
	const connector = row?.results[0] as ConnectorRow;
	const body: ConnectorMe = {
		connectorId: connector.id,
		owner: connector.owner,
		name: connector.name,
		expiresAt: connector.expires_at,
		projects: (projects?.results ?? []) as OwnedRow[],
	};
	c.header("Cache-Control", "no-store");
	return c.json(body);
};

export const connectorRoutes = new Hono<AppEnv>();
connectorRoutes.onError((error, c) => apiError(error, c));
connectorRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});

/** The caller's connectors (admins see all) and the projects they own. */
connectorRoutes.get("/", async (c) => {
	const caller = c.get("caller");
	const timestamp = now();
	const local = caller?.kind === "local";
	const self = local ? null : person(c);
	const everyone = local || Boolean(self?.admin);
	const [rows, projects] = await c.env.DB.batch([
		c.env.DB.prepare(
			`SELECT * FROM connectors WHERE (?=1 OR owner=?) AND (revoked_at IS NULL OR revoked_at>?)
       ORDER BY revoked_at IS NOT NULL, COALESCE(last_seen_at,created_at) DESC LIMIT 200`,
		).bind(Number(everyone), self?.principal ?? "", timestamp - 7 * 86400),
		self
			? ownedProjects(c.env.DB, self.principal, self.tenantId)
			: c.env.DB.prepare("SELECT id,name,organization FROM projects WHERE 0"),
	]);
	const heartbeat = local
		? await c.env.DB.prepare(
				"SELECT last_seen_at,state,message FROM collector_heartbeat WHERE id=1",
			).first<HeartbeatRow>()
		: null;
	const body: ConnectorList = {
		connectors: [
			...(heartbeat ? [localCollector(heartbeat, timestamp)] : []),
			...((rows?.results ?? []) as ConnectorRow[]).map((row) =>
				mapConnector(row, timestamp),
			),
		],
		ownedProjects: (projects?.results ?? []) as OwnedRow[],
	};
	return c.json(body);
});

connectorRoutes.delete("/:id", async (c) => {
	const caller = c.get("caller");
	const local = caller?.kind === "local";
	const self = local ? null : person(c);
	const result = await c.env.DB.prepare(
		"UPDATE connectors SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND (?=1 OR owner=?)",
	)
		.bind(
			now(),
			c.req.param("id"),
			Number(local || Boolean(self?.admin)),
			self?.principal ?? "",
		)
		.run();
	if (!result.meta.changes)
		throw new MonitoringError("NOT_FOUND", "Connector not found", 404);
	// A revoked connector's in-flight leases return to the queue at once.
	await c.env.DB.prepare(
		"UPDATE collection_jobs SET state='queued',lease_token=NULL,lease_expires_at=NULL,lease_connector_id=NULL WHERE state='running' AND lease_connector_id=?",
	)
		.bind(c.req.param("id"))
		.run();
	return c.json({ status: "revoked" });
});

const dataOwnerSchema = z
	.object({ dataOwner: principalSchema.nullable() })
	.strict();

/** Admin: choose whose connector refreshes a project (a tenant member). */
export const projectDataOwnerRoute = async (c: Context<AppEnv>) => {
	const raw = await readJsonBodyWithSize(c, 1024);
	const input = dataOwnerSchema.safeParse(raw.ok ? raw.value : null);
	if (!input.success)
		return c.json({ error: "Choose a tenant member as data owner" }, 400);
	const owner: Principal | null = input.data.dataOwner;
	const result = await c.env.DB.prepare(
		`UPDATE projects SET data_owner=? WHERE id=? AND source='cli'
     AND (? IS NULL OR EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id=projects.tenant_id AND m.principal=?))`,
	)
		.bind(owner, c.req.param("id"), owner, owner)
		.run();
	if (!result.meta.changes) {
		const exists = await c.env.DB.prepare(
			"SELECT 1 AS ok FROM projects WHERE id=? AND source='cli'",
		)
			.bind(c.req.param("id"))
			.first();
		return exists
			? c.json(
					{ error: "The data owner must be a member of the project's tenant" },
					409,
				)
			: c.json({ error: "Project not found" }, 404);
	}
	// Leases held by a previous owner's connector stop at their next renewal.
	return c.json({ dataOwner: owner });
};
