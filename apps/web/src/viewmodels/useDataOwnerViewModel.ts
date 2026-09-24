import { useState } from "react";
import { loadAdminDirectory } from "@/models/adminApi";
import { setDataOwner } from "@/models/connectorApi";
import { useQueryBlock } from "./useQueryBlock";

/** Admin-only: choose which tenant member's connector refreshes a project. */
export function useDataOwnerViewModel(
	enabled: boolean,
	onChanged: () => Promise<unknown>,
) {
	const directory = useQueryBlock(
		enabled ? "data-owner-candidates" : null,
		(signal) => loadAdminDirectory(signal),
		0,
	);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const candidates = [
		...new Set(
			(directory.data?.tenants ?? []).flatMap((tenant) =>
				tenant.members
					.map((member) => member.principal)
					.filter((principal) => principal.startsWith("email:")),
			),
		),
	].sort();
	const assign = async (projectId: string, owner: string | null) => {
		if (busy) return;
		setBusy(projectId);
		setError(null);
		try {
			await setDataOwner(projectId, owner);
			await onChanged();
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not set the data owner.",
			);
		} finally {
			setBusy(null);
		}
	};
	return { candidates, busy, error, assign };
}

export const ownerLabel = (principal: string | null | undefined) =>
	principal ? principal.replace(/^email:/, "") : "No data owner";
