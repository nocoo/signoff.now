import { Button, TooltipProvider } from "@nocoo/basalt";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { queryRow } from "@/models/monitoringApi";
import { publicPull } from "@/test/monitoring-fixture";
import { PullList } from "./PullList";

afterEach(cleanup);
test("checks legend opens from its header without changing sorting", async () => {
	const sort = vi.fn();
	render(
		<PullList
			rows={[]}
			loading={false}
			busy={false}
			sort={{ sort: "updated", sortDirection: "desc" }}
			onSort={sort}
			onOpen={vi.fn()}
			onToggleWatch={vi.fn()}
			aiSchedule={null}
		/>,
	);
	const help = screen.getByRole("button", { name: "Checks status legend" });
	expect(help.closest("th")?.textContent).toContain("Checks & stages");
	expect(screen.queryByRole("region", { name: "Stage colors" })).toBeNull();
	fireEvent.click(help);
	const legend = await screen.findByRole("region", { name: "Stage colors" });
	for (const label of [
		"Passed",
		"Failed",
		"Running",
		"Awaiting approval",
		"Queued",
	])
		expect(within(legend).getByText(label)).toBeTruthy();
	expect(sort).not.toHaveBeenCalled();
	fireEvent.keyDown(legend, { key: "Escape" });
	expect(screen.queryByRole("region", { name: "Stage colors" })).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Sort by Checks & stages" }),
	);
	expect(sort).toHaveBeenCalledWith("progress");
});

test("configurable columns, skeletons and row actions keep one table contract", () => {
	const row = queryRow(publicPull());
	const open = vi.fn(),
		watch = vi.fn(),
		remove = vi.fn(),
		sort = vi.fn();
	const view = (loading: boolean) => (
		<MemoryRouter>
			<TooltipProvider>
				<PullList
					rows={[row]}
					loading={loading}
					busy={false}
					sort={{ sort: "updated", sortDirection: "desc" }}
					onSort={sort}
					onOpen={open}
					onToggleWatch={watch}
					aiSchedule={null}
					columns={["title", "readiness", "updated"]}
					actions={(item) => (
						<Button onClick={() => remove(item)}>Remove member</Button>
					)}
				/>
			</TooltipProvider>
		</MemoryRouter>
	);
	const { rerender } = render(view(true));
	const table = screen.getByRole("table");
	expect(table.getAttribute("aria-busy")).toBe("true");
	expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
	expect(table.querySelectorAll("tbody tr")).toHaveLength(8);
	for (const skeleton of table.querySelectorAll("tbody tr")) {
		expect(skeleton.classList.contains("h-16")).toBe(true);
		expect(skeleton.querySelectorAll("td")).toHaveLength(5);
	}
	rerender(view(false));
	expect(screen.getByRole("table")).toBe(table);
	expect(table.querySelectorAll("tbody td")).toHaveLength(5);
	expect(table.querySelector("tbody tr")?.classList.contains("h-16")).toBe(
		true,
	);
	fireEvent.click(
		screen.getByRole("button", {
			name: `Open PR #${row.pull.number}: ${row.pull.title}`,
		}),
	);
	expect(open).toHaveBeenCalledWith(row, expect.any(HTMLButtonElement));
	fireEvent.click(screen.getByRole("button", { name: /^Watch PR/ }));
	expect(watch).toHaveBeenCalledWith(row);
	fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
	expect(remove).toHaveBeenCalledWith(row);
	fireEvent.click(screen.getByRole("button", { name: "Sort by Pull request" }));
	expect(sort).toHaveBeenCalledWith("title");
});
