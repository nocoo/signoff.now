import type { DataSource } from "@signoff/domain/insights";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { fetchDirectory } from "@/models/directoryApi";
import {
	CONTRIBUTOR_CHANGED,
	useContributorProfile,
} from "./useContributorProfile";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<object>()),
	apiFetch: vi.fn(),
}));
vi.mock("@/models/directoryApi", () => ({ fetchDirectory: vi.fn() }));
const statistics = {
	source: "cli",
	key: "member:ada",
	blocked: false,
	followed: false,
	from: "2026-06-26",
	to: "2026-09-23",
	totals: {
		total: 8,
		open: 2,
		merged: 5,
		closed: 1,
		draft: 0,
		repositories: 2,
		contributors: 1,
		lastCollectedAt: 10,
	},
	repositories: [],
};
beforeEach(() => {
	vi.mocked(apiFetch).mockReset().mockResolvedValue({ statistics });
	vi.mocked(fetchDirectory).mockReset().mockResolvedValue({
		source: "cli",
		revision: 42,
		blockedContributorKeys: [],
		members: [],
		identities: [],
		teams: [],
		tags: [],
		projects: [],
		repositories: [],
	});
});
afterEach(cleanup);
function setup(open = true) {
	return renderHook(
		({ source, key, visible }) => useContributorProfile(source, key, visible),
		{
			initialProps: {
				source: "cli" as DataSource,
				key: "member:ada",
				visible: open,
			},
		},
	);
}
it("loads only cached statistics when opened and clears data across sources", async () => {
	const vm = setup(false);
	await act(async () => {});
	expect(apiFetch).not.toHaveBeenCalled();
	vm.rerender({ source: "cli", key: "member:ada", visible: true });
	await waitFor(() => expect(vm.result.current.data?.totals.total).toBe(8));
	expect(apiFetch).toHaveBeenCalledWith(
		"/api/insights/contributor?source=cli&key=member%3Aada",
		expect.objectContaining({ signal: expect.any(AbortSignal) }),
	);
	vm.rerender({ source: "demo", key: "member:ada", visible: false });
	expect(vm.result.current.data).toBeNull();
});
it("uses the current directory revision, emits a scoped change, and prevents duplicate writes", async () => {
	const vm = setup();
	await waitFor(() => expect(vm.result.current.data).toBeTruthy());
	const listener = vi.fn();
	window.addEventListener(CONTRIBUTOR_CHANGED, listener);
	await act(async () => {
		const first = vm.result.current.setBlocked(true);
		await vm.result.current.setBlocked(true);
		await first;
	});
	expect(fetchDirectory).toHaveBeenCalledTimes(1);
	expect(apiFetch).toHaveBeenCalledWith("/api/directory/blocks?source=cli", {
		method: "POST",
		headers: { "If-Match": '"42"' },
		body: JSON.stringify({ key: "member:ada", blocked: true }),
	});
	expect(listener.mock.calls[0]?.[0].detail).toBe("cli");
	expect(vm.result.current.busy).toBe(false);
	window.removeEventListener(CONTRIBUTOR_CHANGED, listener);
});
it("reports mutation failures and can retry an unblock", async () => {
	const vm = setup();
	await waitFor(() => expect(vm.result.current.data).toBeTruthy());
	vi.mocked(fetchDirectory).mockRejectedValueOnce(
		new Error("Revision unavailable"),
	);
	await act(async () => {
		await vm.result.current.setBlocked(false);
	});
	expect(vm.result.current.error).toBe("Revision unavailable");
	expect(vm.result.current.busy).toBe(false);
	await act(async () => {
		await vm.result.current.setBlocked(false);
	});
	expect(vm.result.current.error).toBeNull();
	vi.mocked(fetchDirectory).mockRejectedValueOnce("failed");
	await act(async () => {
		await vm.result.current.setBlocked(false);
	});
	expect(vm.result.current.error).toBe("Could not update contributor");
});
it("rejects a mismatched contributor result", async () => {
	vi.mocked(apiFetch).mockResolvedValue({
		statistics: { ...statistics, key: "member:bob" },
	});
	const vm = setup();
	await waitFor(() =>
		expect(vm.result.current.error).toBe("Contributor scope mismatch"),
	);
	expect(vm.result.current.data).toBeNull();
});
it("does not write after a source change or unmount during the revision read", async () => {
	const vm = setup();
	await waitFor(() => expect(vm.result.current.data).toBeTruthy());
	const old = vm.result.current.setBlocked;
	let resolve!: (value: Awaited<ReturnType<typeof fetchDirectory>>) => void;
	vi.mocked(fetchDirectory).mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	let pending!: Promise<void>;
	act(() => {
		pending = old(true);
	});
	vm.rerender({ source: "demo", key: "member:ada", visible: false });
	await act(async () => {
		resolve({
			source: "cli",
			revision: 8,
			blockedContributorKeys: [],
			members: [],
			identities: [],
			teams: [],
			tags: [],
			projects: [],
			repositories: [],
		});
		await pending;
		await old(true);
	});
	expect(apiFetch).not.toHaveBeenCalledWith(
		expect.stringContaining("/blocks"),
		expect.anything(),
	);
	const latest = vm.result.current.setBlocked;
	vm.unmount();
	await latest(false);
	expect(fetchDirectory).toHaveBeenCalledTimes(1);
});
