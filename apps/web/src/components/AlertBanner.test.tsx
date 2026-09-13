import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertBanner } from "./AlertBanner";

describe("AlertBanner", () => {
	it("announces errors assertively", () => {
		render(<AlertBanner variant="error">Save failed</AlertBanner>);
		expect(screen.getByRole("alert").textContent).toContain("Save failed");
	});

	it("announces informational and warning updates as status", () => {
		const { rerender } = render(<AlertBanner>Saved</AlertBanner>);
		expect(screen.getByRole("status").textContent).toContain("Saved");

		rerender(<AlertBanner variant="warning">Scores are stale</AlertBanner>);
		expect(screen.getByRole("status").textContent).toContain(
			"Scores are stale",
		);
	});
});
