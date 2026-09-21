import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePullTableLayout } from "./usePullTableLayout";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function TableFixture({ text = "PR" }: { text?: string }) {
	const ref = usePullTableLayout();
	return (
		<div ref={ref} data-testid="container">
			<table>
				<tbody>
					<tr>
						<td>{text}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

it("hides only the needed metadata columns and recalculates when width or content changes", async () => {
	let available = 1000,
		required = 900;
	let onResize: () => void = () => {};
	const disconnect = vi.fn();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				onResize = callback;
			}
			observe() {}
			disconnect = disconnect;
		},
	);
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
		() => available,
	);
	vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
		function (this: HTMLElement) {
			const hidden = this.parentElement?.dataset.hiddenColumns ?? "";
			return (
				required -
				(hidden.includes("author") ? 100 : 0) -
				(hidden.includes("repository") ? 200 : 0)
			);
		},
	);
	const { rerender, unmount } = render(<TableFixture />);
	const container = screen.getByTestId("container");
	expect(container.dataset.hiddenColumns).toBeUndefined();
	available = 850;
	onResize();
	expect(container.dataset.hiddenColumns).toBe("author");
	available = 700;
	onResize();
	expect(container.dataset.hiddenColumns).toBe("author repository");
	available = 1000;
	onResize();
	expect(container.dataset.hiddenColumns).toBeUndefined();
	required = 1400;
	rerender(<TableFixture text="Longer PR title" />);
	await waitFor(() =>
		expect(container.dataset.hiddenColumns).toBe("author repository"),
	);
	expect(container.querySelector("td")?.textContent).toBe("Longer PR title");
	unmount();
	expect(disconnect).toHaveBeenCalledOnce();
});

it("ignores detached refs and containers without a table", () => {
	function Empty() {
		const ref = usePullTableLayout();
		ref(null);
		return <div ref={ref} />;
	}
	expect(() => render(<Empty />)).not.toThrow();
});
