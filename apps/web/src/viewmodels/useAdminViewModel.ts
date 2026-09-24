import { useState } from "react";
import {
	addAdmin,
	addTenantMember,
	loadAdminDirectory,
	removeAdmin,
	removeTenantMember,
} from "@/models/adminApi";
import { useQueryBlock } from "./useQueryBlock";

export function useAdminViewModel() {
	const directory = useQueryBlock(
		"admin-directory",
		(signal) => loadAdminDirectory(signal),
		0,
	);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const run = async (key: string, action: () => Promise<unknown>) => {
		if (busy) return false;
		setBusy(key);
		setError(null);
		try {
			await action();
			return true;
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Administrator request failed.",
			);
			return false;
		} finally {
			await directory.reload();
			setBusy(null);
		}
	};
	return {
		directory,
		busy,
		error,
		addMember: (tenantId: string, member: string) =>
			run(`member:${tenantId}`, () => addTenantMember(tenantId, member.trim())),
		removeMember: (tenantId: string, principal: string) =>
			run(`member:${tenantId}:${principal}`, () =>
				removeTenantMember(tenantId, principal),
			),
		addAdmin: (member: string) => run("admin", () => addAdmin(member.trim())),
		removeAdmin: (principal: string) =>
			run(`admin:${principal}`, () => removeAdmin(principal)),
	};
}
