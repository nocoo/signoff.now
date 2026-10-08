import { hostname } from "node:os";
import { type LoginResult, openBrowser, performLogin } from "@nocoo/base-cli";
import {
	CONNECTOR_PROTOCOL,
	CONNECTOR_PROTOCOL_HEADER,
	type ConnectorMe,
	connectorMeSchema,
} from "@signoff/domain/connector";
import pkg from "../../../../package.json" with { type: "json" };
import type { FetchLike } from "../pipeline/client.ts";
import {
	type ConnectorConfig,
	type ConnectorStore,
	connectorOrigins,
	connectorStore,
	DEFAULT_SERVER,
} from "./connector-config.ts";

const { version } = pkg;

export type ConnectorDeps = {
	store: ConnectorStore;
	login: typeof performLogin;
	openBrowser: (url: string) => Promise<void>;
	fetchImpl: FetchLike;
	now: () => number;
	log: (message: string) => void;
};

export const defaultConnectorDeps = (): ConnectorDeps => ({
	store: connectorStore(),
	login: performLogin,
	openBrowser,
	fetchImpl: globalThis.fetch.bind(globalThis),
	now: () => Math.floor(Date.now() / 1000),
	log: (message) => process.stderr.write(`${message}\n`),
});

export function connectorHeaders(token: string): Record<string, string> {
	return {
		authorization: `Bearer ${token}`,
		[CONNECTOR_PROTOCOL_HEADER]: String(CONNECTOR_PROTOCOL),
	};
}

/** Confirms the token against the machine host; null means it no longer works. */
export async function describeConnector(
	config: ConnectorConfig,
	fetchImpl: FetchLike,
): Promise<ConnectorMe | null> {
	const response = await fetchImpl(`${config.apiOrigin}/api/connector/v1/me`, {
		headers: { accept: "application/json", ...connectorHeaders(config.token) },
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
	});
	if (response.status === 401) return null;
	if (!response.ok)
		throw new Error(
			`SignOff answered ${response.status} while checking the connector`,
		);
	return connectorMeSchema.parse(await response.json());
}

/**
 * Opens the SignOff sign-in page in the browser (Cloudflare Access), receives
 * the connector token on a loopback callback and saves it with mode 0600.
 */
export async function connectorLogin(
	options: { server?: string; name?: string; timeoutMs?: number },
	deps: ConnectorDeps,
): Promise<{ config: ConnectorConfig; me: ConnectorMe }> {
	const origins = connectorOrigins(options.server ?? DEFAULT_SERVER);
	let token = "";
	deps.log(`Opening ${origins.webOrigin} to sign in this connector…`);
	const result: LoginResult = await deps.login({
		apiUrl: origins.webOrigin,
		loginPath: "/api/auth/cli",
		timeoutMs: options.timeoutMs ?? 5 * 60_000,
		openBrowser: deps.openBrowser,
		onSaveToken: (value) => {
			token = value;
		},
		log: deps.log,
		accentColor: "#0ea5e9",
		extraParams: {
			name: (options.name ?? hostname()).slice(0, 80) || "Connector",
			platform: `${process.platform}-${process.arch}`,
			version,
		},
	});
	if (!result.success || !token)
		throw new Error(result.error ?? "Sign-in did not return a connector token");
	const params = result.params ?? {};
	const config: ConnectorConfig = {
		...origins,
		token,
		connectorId: params.connector_id ?? "",
		owner: params.owner ?? "",
		expiresAt: Number(params.expires_at ?? 0),
	};
	deps.store.write(config);
	const me = await describeConnector(config, deps.fetchImpl);
	if (!me) {
		deps.store.clear();
		throw new Error("SignOff rejected the new connector token; sign in again");
	}
	return { config, me };
}

export type ConnectorStatus =
	| { state: "signed_out"; path: string }
	| { state: "expired"; config: ConnectorConfig; path: string }
	| { state: "revoked"; config: ConnectorConfig; path: string }
	| { state: "ready"; config: ConnectorConfig; me: ConnectorMe; path: string };

export async function connectorStatus(
	deps: ConnectorDeps,
): Promise<ConnectorStatus> {
	const path = deps.store.path;
	const config = deps.store.read();
	if (!config) return { state: "signed_out", path };
	if (config.expiresAt <= deps.now()) return { state: "expired", config, path };
	const me = await describeConnector(config, deps.fetchImpl);
	return me
		? { state: "ready", config, me, path }
		: { state: "revoked", config, path };
}

export function connectorLogout(deps: Pick<ConnectorDeps, "store">): boolean {
	const existed = deps.store.read() !== null;
	deps.store.clear();
	return existed;
}
