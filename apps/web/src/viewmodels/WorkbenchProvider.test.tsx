import { demoWorkspace } from "@signoff/domain/demo";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { loadWorkbench } from "@/models/workbenchApi";
import { useWorkbench, WorkbenchProvider } from "./WorkbenchProvider";

vi.mock("@/models/workbenchApi", () => ({ loadWorkbench: vi.fn() }));
afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

it("shares one workbench and source selection between the global header and routed pages", async () => {
	vi.mocked(loadWorkbench).mockResolvedValue({
		...demoWorkspace(1_800_000_000),
		demoMode: true,
		fetchedAt: 1_800_000_000,
		truncated: false,
	});
	const { result } = renderHook(
		() => ({
			header: useWorkbench(),
			page: useWorkbench(),
			navigate: useNavigate(),
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
	expect(loadWorkbench).toHaveBeenCalledOnce();
	act(() => result.current.header.setFilter({ source: "cli" }));
	expect(result.current.page.filter.source).toBe("cli");
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
	expect(
		result.current.page.visible.every(
			({ project }) => project.organization === "github.com",
		),
	).toBe(true);
	expect(loadWorkbench).toHaveBeenCalledOnce();
});

it("rejects consumers outside the global provider", () => {
	expect(() => renderHook(useWorkbench)).toThrow(
		"WorkbenchProvider is required",
	);
});
