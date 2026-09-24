import {
	CONNECTOR_ONLINE_SECONDS,
	CONNECTOR_TOKEN_DAYS,
	CONNECTOR_TOKEN_PREFIX,
	type Connector,
	type ConnectorCapabilities,
	type ConnectorLogin,
	connectorCapabilitiesSchema,
} from "@signoff/domain/connector";
import type { Principal } from "@signoff/domain/principal";

export type ConnectorRow = {
	id: string;
	owner: string;
	name: string;
	platform: string;
	version: string;
	created_at: number;
	expires_at: number;
	last_seen_at: number | null;
	state: "ready" | "auth_required" | "error" | null;
	message: string;
	capabilities_json: string;
	revoked_at: number | null;
};

function base64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function mapConnector(row: ConnectorRow, timestamp: number): Connector {
	const capabilities = connectorCapabilitiesSchema.safeParse(
		JSON.parse(row.capabilities_json),
	);
	return {
		id: row.id,
		owner: row.owner,
		name: row.name,
		platform: row.platform,
		version: row.version,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		lastSeenAt: row.last_seen_at,
		state: row.state,
		message: row.message,
		capabilities: capabilities.success ? capabilities.data : {},
		online:
			row.revoked_at === null &&
			row.last_seen_at !== null &&
			timestamp - row.last_seen_at <= CONNECTOR_ONLINE_SECONDS,
		revoked: row.revoked_at !== null,
	};
}

/** Issues a new connector; only the SHA-256 of its token is stored. */
export async function issueConnector(
	db: D1Database,
	owner: Principal,
	login: Pick<ConnectorLogin, "name" | "platform" | "version">,
	timestamp: number,
): Promise<{ id: string; token: string; expiresAt: number }> {
	const token = `${CONNECTOR_TOKEN_PREFIX}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
	const id = crypto.randomUUID();
	const expiresAt = timestamp + CONNECTOR_TOKEN_DAYS * 86400;
	await db
		.prepare(
			"INSERT INTO connectors(id,owner,name,platform,version,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
		)
		.bind(
			id,
			owner,
			login.name,
			login.platform,
			login.version,
			await hashToken(token),
			timestamp,
			expiresAt,
		)
		.run();
	return { id, token, expiresAt };
}

/** Active connector for a bearer token, or null when unknown, revoked or expired. */
export async function findConnector(
	db: D1Database,
	token: string,
	timestamp: number,
): Promise<ConnectorRow | null> {
	return db
		.prepare(
			"SELECT * FROM connectors WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
		)
		.bind(await hashToken(token), timestamp)
		.first<ConnectorRow>();
}

export async function recordHeartbeat(
	db: D1Database,
	connectorId: string,
	input: {
		state: "ready" | "auth_required" | "error";
		message: string;
		capabilities?: ConnectorCapabilities;
		version?: string;
	},
	timestamp: number,
) {
	await db
		.prepare(`UPDATE connectors SET last_seen_at=?,state=?,message=?,
      capabilities_json=COALESCE(?,capabilities_json),version=COALESCE(?,version)
      WHERE id=? AND revoked_at IS NULL`)
		.bind(
			timestamp,
			input.state,
			input.message,
			input.capabilities ? JSON.stringify(input.capabilities) : null,
			input.version ?? null,
			connectorId,
		)
		.run();
}
