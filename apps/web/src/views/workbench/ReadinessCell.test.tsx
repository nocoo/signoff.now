import { TooltipProvider } from "@nocoo/basalt";
import { presentReadiness } from "@signoff/domain/ai-readiness";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readinessDisplay } from "@/models/readinessDisplay";
import { ReadinessCell } from "./ReadinessCell";

afterEach(cleanup);
it("retains the prior badge with an accessible update note, then replaces it with the new result", async () => {
	const result = {
		kind: "running" as const,
		model: "jev-1.13.0",
		rubric: "test",
		fingerprint: "old",
		evaluatedAt: "2026-09-21T00:00:00Z",
		probabilities: { running: 1 },
		confidence: 1,
	};
	const pending = readinessDisplay(
		presentReadiness("pending", null, null, result),
		"project",
		null,
		0,
	);
	const view = (display: typeof pending) => (
		<TooltipProvider delayDuration={0}>
			<ReadinessCell display={display} failed={false} />
		</TooltipProvider>
	);
	const mounted = render(view(pending));
	expect(screen.getByText("Running")).toBeTruthy();
	expect(screen.queryByText("Pending")).toBeNull();
	const note = screen.getByRole("button", {
		name: /Last result · queued/,
	});
	fireEvent.focus(note);
	expect((await screen.findByRole("tooltip")).textContent).toContain(
		"not been verified",
	);
	mounted.rerender(
		view(
			readinessDisplay(
				presentReadiness("complete", { ...result, kind: "review_needed" }),
				"project",
				null,
				0,
			),
		),
	);
	expect(screen.getByText("Review Needed")).toBeTruthy();
	expect(screen.queryByText("Running")).toBeNull();
	expect(screen.queryByRole("button")).toBeNull();
});
