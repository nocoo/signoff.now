import { z } from "zod";

/** Bumped when the collector HTTP contract changes incompatibly. */
export const CONNECTOR_PROTOCOL = 1;
export const CONNECTOR_PROTOCOL_HEADER = "x-signoff-connector-protocol";
export const CONNECTOR_TOKEN_PREFIX = "sfc_";
export const CONNECTOR_TOKEN_DAYS = 90;
/** A connector counts as online if it sent a heartbeat this recently. */
export const CONNECTOR_ONLINE_SECONDS = 90;

export const isConnectorToken = (value: string): boolean =>
	/^sfc_[A-Za-z0-9_-]{43}$/.test(value);

/** Loopback callback targets only; the token must never leave the machine. */
export function isLoopbackCallback(value: string): boolean {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return (
		url.protocol === "http:" &&
		["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
		url.port !== "" &&
		url.pathname === "/callback" &&
		!url.username &&
		!url.password
	);
}

export const connectorLoginSchema = z
	.object({
		callback: z.string().max(200).refine(isLoopbackCallback, {
			message: "Callback must be a loopback /callback URL",
		}),
		state: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
		name: z.string().trim().min(1).max(80).default("Connector"),
		platform: z.string().trim().max(40).default(""),
		version: z.string().trim().max(40).default(""),
	})
	.strict();
export type ConnectorLogin = z.infer<typeof connectorLoginSchema>;

export const connectorCapabilitiesSchema = z
	.object({
		az: z
			.object({ installed: z.boolean(), loggedIn: z.boolean() })
			.strict()
			.optional(),
		gh: z
			.object({ installed: z.boolean(), loggedIn: z.boolean() })
			.strict()
			.optional(),
	})
	.strict();
export type ConnectorCapabilities = z.infer<typeof connectorCapabilitiesSchema>;

export const connectorSchema = z.object({
	id: z.string(),
	owner: z.string(),
	name: z.string(),
	platform: z.string(),
	version: z.string(),
	createdAt: z.number(),
	expiresAt: z.number(),
	lastSeenAt: z.number().nullable(),
	state: z.enum(["ready", "auth_required", "error"]).nullable(),
	message: z.string(),
	capabilities: connectorCapabilitiesSchema,
	online: z.boolean(),
	revoked: z.boolean(),
	/** The trusted loopback collector; it has no token and cannot be revoked. */
	local: z.boolean().optional(),
});
export type Connector = z.infer<typeof connectorSchema>;

export const connectorListSchema = z.object({
	connectors: z.array(connectorSchema),
	/** Projects this caller owns as data owner, in the current tenant. */
	ownedProjects: z.array(
		z.object({ id: z.string(), name: z.string(), organization: z.string() }),
	),
});
export type ConnectorList = z.infer<typeof connectorListSchema>;

export const connectorMeSchema = z.object({
	connectorId: z.string(),
	owner: z.string(),
	name: z.string(),
	expiresAt: z.number(),
	projects: z.array(
		z.object({ id: z.string(), name: z.string(), organization: z.string() }),
	),
});
export type ConnectorMe = z.infer<typeof connectorMeSchema>;
