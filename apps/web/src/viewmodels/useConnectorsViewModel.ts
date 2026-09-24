import type { Connector } from "@signoff/domain/connector";
import { useState } from "react";
import { loadConnectors, revokeConnector } from "@/models/connectorApi";
import { useQueryBlock } from "./useQueryBlock";

export type GuideStep = "install" | "login" | "owner" | "az" | "run";

/**
 * The first incomplete step drives the guide. Progress comes from the
 * connector's own heartbeats, so the page updates while the user works in a
 * terminal.
 */
export function guideProgress(
	connectors: Connector[],
	ownedProjects: number,
): { done: Record<GuideStep, boolean>; current: GuideStep | null } {
	const active = connectors.filter((c) => !c.revoked);
	const online = active.find((c) => c.online);
	const az = active.some((c) => c.capabilities.az?.loggedIn);
	const done: Record<GuideStep, boolean> = {
		install: active.length > 0,
		login: active.length > 0,
		owner: ownedProjects > 0,
		az,
		run: Boolean(online),
	};
	const order: GuideStep[] = ["install", "login", "owner", "az", "run"];
	return { done, current: order.find((step) => !done[step]) ?? null };
}

export function useConnectorsViewModel() {
	const list = useQueryBlock(
		"connectors",
		(signal) => loadConnectors(signal),
		5000,
	);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const revoke = async (id: string) => {
		if (busy) return;
		setBusy(id);
		setError(null);
		try {
			await revokeConnector(id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not revoke connector.");
		} finally {
			await list.reload();
			setBusy(null);
		}
	};
	const data = list.data;
	return {
		list,
		busy,
		error,
		revoke,
		progress: guideProgress(
			data?.connectors ?? [],
			data?.ownedProjects.length ?? 0,
		),
	};
}
