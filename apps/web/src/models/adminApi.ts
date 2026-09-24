import { adminDirectorySchema } from "@signoff/domain/principal";
import { apiFetch } from "@/lib/api";

export const loadAdminDirectory = async (signal?: AbortSignal) =>
	adminDirectorySchema.parse(
		await apiFetch("/api/admin/directory", { signal }),
	);

export const addTenantMember = (tenantId: string, member: string) =>
	apiFetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/members`, {
		method: "POST",
		body: JSON.stringify({ member }),
	});

export const removeTenantMember = (tenantId: string, principal: string) =>
	apiFetch(
		`/api/admin/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(principal)}`,
		{ method: "DELETE" },
	);

export const addAdmin = (member: string) =>
	apiFetch("/api/admin/admins", {
		method: "POST",
		body: JSON.stringify({ member }),
	});

export const removeAdmin = (principal: string) =>
	apiFetch(`/api/admin/admins/${encodeURIComponent(principal)}`, {
		method: "DELETE",
	});
