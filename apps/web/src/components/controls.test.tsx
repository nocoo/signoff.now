/**
 * Control geometry, asserted rather than eyeballed.
 *
 * These are the specific defects that shipped: a select whose chevron sat hard
 * against the right border, four different label→control gaps in one app, and
 * labels with no `htmlFor` at all. jsdom does not do layout, so this checks the
 * contract that produces the layout — which token each control resolves to —
 * not pixel positions.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

describe("Field", () => {
	it("wires the label to the control it renders", () => {
		// A <Label> with no htmlFor looks identical and does nothing: clicking
		// the text does not focus, and a screen reader announces no name.
		render(<Field label="Team">{(id) => <Input id={id} />}</Field>);
		expect(screen.getByLabelText("Team")).toBeTruthy();
	});

	it("owns the label gap so callers cannot each pick one", () => {
		const { container } = render(
			<Field label="Team">{(id) => <Input id={id} />}</Field>,
		);
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain("gap-(--control-gap)");
		// No caller-side spacing utility: that is how 1 / 1.5 / 2 diverged.
		expect(wrapper.className).not.toMatch(/space-y-/);
	});

	it("keeps a caller's layout class without letting it set the gap", () => {
		const { container } = render(
			<Field label="Team" className="w-44">
				{(id) => <Input id={id} />}
			</Field>,
		);
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain("w-44");
		expect(wrapper.className).toContain("gap-(--control-gap)");
	});

	it("shows an error in place of a hint, not both", () => {
		render(
			<Field label="URL" hint="https://…" error="Must be https">
				{(id) => <Input id={id} />}
			</Field>,
		);
		expect(screen.getByRole("alert").textContent).toBe("Must be https");
		expect(screen.queryByText("https://…")).toBeNull();
	});
});

describe("Select", () => {
	const mount = () =>
		render(
			<Select aria-label="Status">
				<option value="a">A</option>
			</Select>,
		);

	it("reserves trailing space so the chevron does not touch the border", () => {
		// The reported bug: the browser's own arrow sits against the edge. The
		// text pad must be the LARGER trailing token, not the symmetric one.
		const select = mount().container.querySelector("select") as HTMLElement;
		expect(select.className).toContain("pe-(--control-pad-trailing)");
		expect(select.className).toContain("ps-(--control-pad-x)");
	});

	it("hides the native arrow, since it cannot be positioned", () => {
		const select = mount().container.querySelector("select") as HTMLElement;
		expect(select.className).toContain("appearance-none");
	});

	it("insets the drawn chevron and keeps it out of the hit area", () => {
		const { container } = mount();
		const icon = container.querySelector("svg") as SVGElement;
		expect(icon.getAttribute("class")).toContain("end-(--control-pad-x)");
		// Clicks must reach the select underneath, not stop at the glyph.
		expect(icon.getAttribute("class")).toContain("pointer-events-none");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
	});

	it("matches Input's height and radius token for token", () => {
		// These sit side by side in every filter row; two different heights is
		// exactly what the tokens exist to prevent.
		const select = mount().container.querySelector("select") as HTMLElement;
		const { container } = render(<Input />);
		const input = container.querySelector("input") as HTMLElement;
		for (const token of ["h-(--control-h)", "rounded-(--control-radius)"]) {
			expect(select.className).toContain(token);
			expect(input.className).toContain(token);
		}
	});
});
