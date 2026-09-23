import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useContext } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AvatarSourceContext } from "@/components/EntityAvatar";
import { loadPulls } from "@/models/monitoringApi";
import { queryFixture } from "@/test/monitoring-fixture";
import { useWorkbench, WorkbenchProvider } from "./WorkbenchProvider";

vi.mock("@/models/monitoringApi", async (original) => ({
	...(await original<typeof import("@/models/monitoringApi")>()),
	loadPulls: vi.fn(async () => queryFixture().pulls),
	loadCatalog: vi.fn(async () => queryFixture().catalog),
	loadCollector: vi.fn(async () => queryFixture().collector),
}));
afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

it("shares one workbench and source selection between the global header and routed pages", async () => {
	const { result } = renderHook(
		() => ({
			header: useWorkbench(),
			page: useWorkbench(),
			navigate: useNavigate(),
			avatarSource: useContext(AvatarSourceContext),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<MemoryRouter>
					<WorkbenchProvider>{children}</WorkbenchProvider>
				</MemoryRouter>
			),
		},
	);
	await waitFor(() => expect(result.current.page.loading).toBe(false));
	expect(result.current.header).toBe(result.current.page);
	expect(loadPulls).toHaveBeenCalledOnce();
	act(() => result.current.header.setFilter({ source: "cli" }));
	expect(result.current.page.filter.source).toBe("cli");
	expect(result.current.avatarSource).toBe("cli");
	act(() => result.current.navigate("/projects"));
	expect(result.current.page.filter.source).toBe("cli");
	act(() =>
		result.current.page.setFilter({
			source: "demo",
			organization: "github.com",
		}),
	);
	act(() => result.current.navigate("/"));
	expect(result.current.header.filter.source).toBe("demo");
	expect(result.current.avatarSource).toBe("demo");
	expect(result.current.header.filter.source).toBe("demo");
});

it("rejects consumers outside the global provider", () => {
	expect(() => renderHook(useWorkbench)).toThrow(
		"WorkbenchProvider is required",
	);
});
