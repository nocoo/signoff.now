import { connectorListSchema } from "@signoff/domain/connector";
import { apiFetch } from "@/lib/api";

export const loadConnectors = async (signal?: AbortSignal) =>
	connectorListSchema.parse(await apiFetch("/api/connectors", { signal }));

export const revokeConnector = (id: string) =>
	apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setDataOwner = (projectId: string, dataOwner: string | null) =>
	apiFetch(`/api/projects/${encodeURIComponent(projectId)}/data-owner`, {
		method: "PUT",
		body: JSON.stringify({ dataOwner }),
	});

/** Commands shown in the guide; `server` is the site the browser is on. */
export function connectorCommands(server: string) {
	const origin = new URL(server).origin;
	return {
		install: "npm install -g @nocoo/signoff",
		login:
			origin === "https://signoff.hexly.ai"
				? "signoff connector login"
				: `signoff connector login --server ${origin}`,
		azLogin: "az login --scope 499b84ac-1321-427f-aa17-267ca6975798/.default",
		daemon: "signoff daemon",
		status: "signoff connector status",
	};
}
