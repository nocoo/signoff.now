import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_GROUPS } from "@/lib/navigation";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/viewmodels/SessionProvider", () => ({
	useSession: () => ({
		state: {
			status: "ready",
			session: {
				authenticated: false,
				local: true,
				principal: null,
				email: null,
				name: null,
				service: false,
				admin: true,
				tenants: [],
				tenantId: null,
			},
		},
		reload: vi.fn(),
		switchTenant: vi.fn(),
	}),
}));
vi.mock("@/viewmodels/WorkbenchProvider", () => ({
	useWorkbench: () => ({
		filter: { source: "cli" },
		setFilter: vi.fn(),
		projects: [],
	}),
}));
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/theme-toggle", () => ({
	ThemeToggle: () => null,
}));
vi.mock("@/components/layout/header-links", () => ({
	HeaderTooltip: ({ children }: { children: ReactNode }) => children,
	HexlyLink: () => null,
}));

afterEach(cleanup);
it.each(
	NAV_GROUPS.flatMap((group) =>
		group.items.map((item) => ({
			path: item.href,
			title: item.label,
			category: group.label,
		})),
	),
)("marks the current page correctly in the only breadcrumb on $path", async ({
	path,
	title,
	category,
}) => {
	const { container } = render(
		<MemoryRouter initialEntries={[path]}>
			<AppShell />
		</MemoryRouter>,
	);
	await act(async () => {});
	const breadcrumbs = screen.getAllByRole("navigation", { name: "Breadcrumb" });
	expect(breadcrumbs).toHaveLength(1);
	const current = breadcrumbs[0]!.querySelector("[aria-current=page]");
	expect(current?.textContent).toBe(title);
	expect(breadcrumbs[0]!.textContent).toContain(category);
	expect(
		container.querySelectorAll("nav[aria-label=Breadcrumb] a"),
	).toHaveLength(0);
});
