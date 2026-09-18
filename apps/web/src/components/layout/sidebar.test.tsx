import { TooltipProvider } from "@nocoo/basalt";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryFixture } from "@/test/monitoring-fixture";
import { Sidebar } from "./sidebar";

const vm = {
	filter: { source: "cli" },
	collector: queryFixture().collector,
	collectionError: null as string | null,
};
vi.mock("@/viewmodels/WorkbenchProvider", () => ({ useWorkbench: () => vm }));
beforeEach(() => {
	vm.collector = queryFixture().collector;
	vm.collectionError = null;
});
afterEach(cleanup);
const renderSidebar = (collapsed = false, onToggle = vi.fn()) =>
	render(
		<MemoryRouter>
			<TooltipProvider>
				<Sidebar collapsed={collapsed} onToggle={onToggle} userLabel="Dev" />
			</TooltipProvider>
		</MemoryRouter>,
	);

it("places collection failures above the sidebar user and lets them be dismissed", () => {
	vm.collectionError = "Collector unavailable";
	renderSidebar();
	const status = screen.getByRole("region", { name: "Collection progress" });
	expect(status.closest("aside")).not.toBeNull();
	expect(
		status.compareDocumentPosition(screen.getByText("Dev")) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).not.toBe(0);
	expect(status.textContent).toContain("Collector unavailable");
	fireEvent.click(
		screen.getByRole("button", { name: "Dismiss collection progress" }),
	);
	expect(
		screen.queryByRole("region", { name: "Collection progress" }),
	).toBeNull();
});
it("keeps a compact status above the avatar when collapsed", () => {
	vm.collectionError = "Collector unavailable";
	const expand = vi.fn();
	renderSidebar(true, expand);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Collection needs attention. Expand sidebar for details",
		}),
	);
	expect(expand).toHaveBeenCalledOnce();
});
it("leaves the sidebar quiet when no collection is pending", () => {
	renderSidebar();
	expect(
		screen.queryByRole("region", { name: "Collection progress" }),
	).toBeNull();
});
