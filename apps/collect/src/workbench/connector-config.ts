import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@nocoo/base-cli";
import { z } from "zod";

export const DEFAULT_SERVER = "https://signoff.hexly.ai";

export const connectorConfigSchema = z.object({
	/** Browser origin behind Cloudflare Access (sign-in page, web UI). */
	webOrigin: z.url(),
	/** Machine origin that accepts the connector token. */
	apiOrigin: z.url(),
	connectorId: z.string().min(1),
	token: z.string().regex(/^sfc_[A-Za-z0-9_-]{43}$/),
	owner: z.string().min(1),
	expiresAt: z.number().int().positive(),
});
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

/**
 * signoff.example.com signs in; signoff-ingest.example.com carries the token.
 * Loopback servers (local development) use one origin for both.
 */
export function connectorOrigins(server: string): {
	webOrigin: string;
	apiOrigin: string;
} {
	const url = new URL(server);
	if (
		(url.protocol !== "https:" &&
			!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new TypeError(
			"Use an https server origin such as https://signoff.hexly.ai",
		);
	const [label = "", ...rest] = url.hostname.split(".");
	if (rest.length < 2 || url.protocol !== "https:")
		return { webOrigin: url.origin, apiOrigin: url.origin };
	const first = label.replace(/-ingest$/, "");
	return {
		webOrigin: `https://${first}.${rest.join(".")}`,
		apiOrigin: `https://${first}-ingest.${rest.join(".")}`,
	};
}

export type ConnectorStore = {
	read: () => ConnectorConfig | null;
	write: (config: ConnectorConfig) => void;
	clear: () => void;
	path: string;
};

/** `$XDG_CONFIG_HOME/signoff/connector.json`, written with mode 0600. */
export function connectorStore(
	env: Record<string, string | undefined> = process.env,
): ConnectorStore {
	const dir = join(
		env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
		"signoff",
	);
	const manager = new ConfigManager<Record<string, unknown>>(dir, false, {
		prodFilename: "connector.json",
	});
	return {
		path: manager.configPath,
		read: () => {
			const parsed = connectorConfigSchema.safeParse(manager.read());
			return parsed.success ? parsed.data : null;
		},
		write: (config) => manager.write(connectorConfigSchema.parse(config)),
		clear: () => manager.delete(),
	};
}
