import { demoWorkspace } from "@signoff/domain/demo";
import type { Project } from "@signoff/domain/workbench";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadinessDialog } from "./ReadinessDialog";

afterEach(cleanup);
const project: Project = {
	...demoWorkspace(1_800_000_000).projects[0],
	mergeRequirements: [
		{ id: "ci", name: "CI", kind: "build" },
		{ id: "review", name: "Review gate", kind: "review" },
	],
	readinessRules: [
		{ gateId: "ci", label: "CI", color: "blue" },
		{ gateId: "review", label: "Human review", color: "orange" },
	],
};
const props = {
	project,
	pulls: [],
	busy: null,
	error: null,
	onSave: vi.fn().mockResolvedValue(true),
	onClose: vi.fn(),
	restoreFocus: vi.fn(),
};
describe("readiness dialog interactions", () => {
	it("keeps editing and cancellation available while a background collection request is busy", () => {
		const { rerender } = render(
			<ReadinessDialog {...props} busy="auto-collect" />,
		);
		const input = screen.getByRole("textbox", {
			name: "Review gate display name",
		}) as HTMLInputElement;
		expect(input.disabled).toBe(false);
		input.focus();
		fireEvent.change(input, { target: { value: "Revised label" } });
		expect(document.activeElement).toBe(input);
		expect(
			(
				screen.getByRole("button", {
					name: "Save readiness",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		rerender(<ReadinessDialog {...props} />);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe("Revised label");
		rerender(<ReadinessDialog {...props} busy="readiness" />);
		expect(input.disabled).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
	it("retains keyboard focus at a boundary and only offers actual requirements", async () => {
		render(<ReadinessDialog {...props} />);
		const up = screen.getByRole("button", { name: "Move Human review up" });
		up.focus();
		fireEvent.click(up);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Move Human review" }),
			),
		);
		fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
		expect(
			document
				.querySelector("[data-readiness-rule]")
				?.getAttribute("data-readiness-rule"),
		).toBe("build:ci");
		expect(
			screen.queryByRole("button", { name: "Move Ready to merge" }),
		).toBeNull();
		expect(
			screen.queryByRole("combobox", { name: "Add policy rule" }),
		).toBeNull();
	});
});
