import { Field } from "@nocoo/basalt";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectControl } from "./SelectControl";

describe("SelectControl", () => {
	const mount = (onChange = vi.fn()) =>
		render(
			<SelectControl aria-label="Status" value="" onChange={onChange}>
				<option value="">Any</option>
				<option value="active">Active</option>
			</SelectControl>,
		);

	it("renders the official Basalt combobox geometry", () => {
		mount();
		const select = screen.getByRole("combobox");
		expect(select.className).toContain("bg-basalt-control");
		expect(select.className).toContain("rounded-basalt-md");
		expect(select.className).toContain("h-9");
	});

	it("maps the application's blank option through the Basalt select", async () => {
		const onChange = vi.fn();
		mount(onChange);
		fireEvent.click(screen.getByRole("combobox"));
		fireEvent.click(await screen.findByRole("option", { name: "Active" }));
		expect(onChange).toHaveBeenCalledWith("active");
	});

	it("preserves Field hint and error relationships on the trigger", () => {
		const { rerender } = render(
			<Field label="Enabled" hint="Disabled repos are skipped.">
				<SelectControl value="yes" onChange={vi.fn()}>
					<option value="yes">Enabled</option>
					<option value="no">Disabled</option>
				</SelectControl>
			</Field>,
		);
		let trigger = screen.getByRole("combobox", { name: "Enabled" });
		const hint = screen.getByText("Disabled repos are skipped.");
		expect(trigger.getAttribute("aria-describedby")).toBe(hint.id);

		rerender(
			<Field label="Enabled" error="Choose a collection state">
				<SelectControl value="yes" onChange={vi.fn()}>
					<option value="yes">Enabled</option>
					<option value="no">Disabled</option>
				</SelectControl>
			</Field>,
		);
		trigger = screen.getByRole("combobox", { name: "Enabled" });
		const error = screen.getByRole("alert");
		expect(trigger.getAttribute("aria-invalid")).toBe("true");
		expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
	});
});
