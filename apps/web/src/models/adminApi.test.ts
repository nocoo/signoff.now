import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	addAdmin,
	addTenantMember,
	loadAdminDirectory,
	removeAdmin,
	removeTenantMember,
} from "./adminApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const call = () => {
	const calls = vi.mocked(apiFetch).mock.calls;
	return calls[calls.length - 1]!;
};
beforeEach(() => vi.mocked(apiFetch).mockReset());

it("reads and validates the admin directory", async () => {
	vi.mocked(apiFetch).mockResolvedValue({ tenants: [], admins: [] });
	expect(await loadAdminDirectory()).toEqual({ tenants: [], admins: [] });
	expect(call()[0]).toBe("/api/admin/directory");
	vi.mocked(apiFetch).mockResolvedValue({ tenants: "bad" });
	await expect(loadAdminDirectory()).rejects.toThrow();
});

it("encodes tenant and principal paths for writes", async () => {
	vi.mocked(apiFetch).mockResolvedValue({});
	await addTenantMember("team a", "a@x.io");
	expect(call()).toEqual([
		"/api/admin/tenants/team%20a/members",
		{ method: "POST", body: JSON.stringify({ member: "a@x.io" }) },
	]);
	await removeTenantMember("default", "email:a@x.io");
	expect(call()).toEqual([
		"/api/admin/tenants/default/members/email%3Aa%40x.io",
		{ method: "DELETE" },
	]);
	await addAdmin("service:ci");
	expect(call()).toEqual([
		"/api/admin/admins",
		{ method: "POST", body: JSON.stringify({ member: "service:ci" }) },
	]);
	await removeAdmin("service:ci");
	expect(call()).toEqual([
		"/api/admin/admins/service%3Aci",
		{ method: "DELETE" },
	]);
});
