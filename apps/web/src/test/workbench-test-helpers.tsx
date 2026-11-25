import { TooltipProvider } from "@nocoo/basalt";
import type { ProjectWrite } from "@signoff/domain/workbench";
import {
	renderHook,
	render as renderTestingView,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { expect, vi } from "vitest";
import type * as monitoringApi from "@/models/monitoringApi";
import { queryFixture } from "@/test/monitoring-fixture";
import { useWorkbenchViewModel } from "@/viewmodels/useWorkbenchViewModel";

export const draft: ProjectWrite = {
	provider: "ado",
	name: "Core",
	organization: "northstar",
	projectKey: "Platform",
	description: "Services",
	owner: "Maya",
	enabled: true,
	repositories: [],
};

export const fixture = queryFixture();
export const pendingEnvelope = {
	...fixture.envelope,
	schemaVersion: 2 as const,
};

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((r, fail) => {
		resolve = r;
		reject = fail;
	});
	return { promise, resolve, reject };
}

export const renderView = (ui: ReactNode) =>
	renderTestingView(<TooltipProvider>{ui}</TooltipProvider>);

export function renderWorkbenchHook(path = "/") {
	return renderHook(
		() => ({
			vm: useWorkbenchViewModel(),
			location: useLocation(),
			navigate: useNavigate(),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
			),
		},
	);
}

export const loaded = async (
	result: ReturnType<typeof renderWorkbenchHook>["result"],
) =>
	waitFor(() => {
		expect(result.current.vm.loading).toBe(false);
		expect(result.current.vm.collector).not.toBeNull();
	});

export function resetWorkbenchMocks(api: typeof monitoringApi) {
	vi.resetAllMocks();
	localStorage.clear();
	vi.mocked(api.loadCollectorHistory).mockResolvedValue({
		data: [],
		nextCursor: null,
	});
	vi.mocked(api.loadCatalog).mockImplementation(
		async (source) => queryFixture(source).catalog,
	);
	vi.mocked(api.loadPulls).mockImplementation(
		async (query) =>
			queryFixture(
				new URLSearchParams(query).get("source") === "sample" ? "demo" : "cli",
			).pulls,
	);
	vi.mocked(api.loadCollector).mockImplementation(
		async (source) => queryFixture(source).collector,
	);
	vi.mocked(api.loadPull).mockImplementation(async (source, id) => {
		const sourceFixture = queryFixture(source);
		const firstPull = sourceFixture.pulls.data[0];
		if (!firstPull) throw new Error("Missing fixture pull");
		return {
			...sourceFixture.envelope,
			data: {
				...firstPull,
				id,
				description: "Full detail",
			},
		};
	});
	vi.mocked(api.lookupPull).mockImplementation(async (source, reference) => {
		const sourceFixture = queryFixture(source);
		const firstPull = sourceFixture.pulls.data[0];
		if (!firstPull) throw new Error("Missing fixture pull");
		return {
			...sourceFixture.envelope,
			data: {
				...firstPull,
				number: reference.number,
				description: "Full detail",
			},
		};
	});
	vi.mocked(api.loadPending).mockResolvedValue({
		...pendingEnvelope,
		data: [],
		page: { ...fixture.page, total: 0 },
	});
	vi.mocked(api.addWatches).mockResolvedValue({
		results: [{ status: "added" }],
	});
	vi.mocked(api.removeWatches).mockResolvedValue({
		results: [{ status: "removed" }],
	});
	vi.mocked(api.discover).mockResolvedValue({ jobs: [] });
	vi.mocked(api.refreshWatches).mockResolvedValue({ jobs: [] });
}
