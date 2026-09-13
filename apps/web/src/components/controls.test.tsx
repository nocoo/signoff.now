import { Input } from "@nocoo/basalt";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { SelectControl } from "./SelectControl";

describe("Field", () => {
	it("wires the label to the control it renders", () => {
		render(<Field label="Team">{(id) => <Input id={id} />}</Field>);
		expect(screen.getByLabelText("Team")).toBeTruthy();
	});

	it("uses Basalt's shared label gap", () => {
		const { container } = render(
			<Field label="Team">{(id) => <Input id={id} />}</Field>,
		);
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain("gap-1.5");
		expect(wrapper.className).not.toMatch(/space-y-/);
	});

	it("keeps a caller's layout class", () => {
		const { container } = render(
			<Field label="Team" className="w-44">
				{(id) => <Input id={id} />}
			</Field>,
		);
		expect(container.firstElementChild?.className).toContain("w-44");
	});

	it("shows an error in place of a hint", () => {
		render(
			<Field label="URL" hint="https://…" error="Must be https">
				{(id) => <Input id={id} />}
			</Field>,
		);
		expect(screen.getByRole("alert").textContent).toBe("Must be https");
		expect(screen.queryByText("https://…")).toBeNull();
	});
});

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
				{(id) => (
					<SelectControl id={id} value="yes" onChange={vi.fn()}>
						<option value="yes">Enabled</option>
						<option value="no">Disabled</option>
					</SelectControl>
				)}
			</Field>,
		);
		let trigger = screen.getByRole("combobox", { name: "Enabled" });
		const hint = screen.getByText("Disabled repos are skipped.");
		expect(trigger.getAttribute("aria-describedby")).toBe(hint.id);

		rerender(
			<Field label="Enabled" error="Choose a collection state">
				{(id) => (
					<SelectControl id={id} value="yes" onChange={vi.fn()}>
						<option value="yes">Enabled</option>
						<option value="no">Disabled</option>
					</SelectControl>
				)}
			</Field>,
		);
		trigger = screen.getByRole("combobox", { name: "Enabled" });
		const error = screen.getByRole("alert");
		expect(trigger.getAttribute("aria-invalid")).toBe("true");
		expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
	});
});
