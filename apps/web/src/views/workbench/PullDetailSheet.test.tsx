import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { queryRow } from "@/models/monitoringApi";
import type { PullRow } from "@/models/workbench";
import {
	fixtureObservation,
	fixtureProject,
	fixturePull,
	publicPull,
} from "@/test/monitoring-fixture";
import { PullDetailSheet } from "./PullDetailSheet";

afterEach(cleanup);
function show(row: PullRow | null, loading = false) {
	const onToggleWatch = vi.fn();
	render(
		<PullDetailSheet
			row={row}
			missing={false}
			onClose={vi.fn()}
			returnFocus={{ current: null }}
			onScan={vi.fn()}
			canScan={false}
			busy={false}
			loading={loading}
			onToggleWatch={onToggleWatch}
		/>,
	);
	return onToggleWatch;
}

it("keeps loading details accessible and dismissible before a snapshot arrives", () => {
	show(null, true);
	expect(
		screen.getByRole("dialog", { name: "Loading PR details" }),
	).toBeTruthy();
	expect(
		screen.getByRole("status", { name: "Loading PR details" }),
	).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Close pull request details" }),
	).toHaveProperty("disabled", false);
	expect(screen.queryByText("Pull request unavailable")).toBeNull();
});

it("loads the full description without obscuring an available summary", () => {
	show(queryRow(publicPull(fixturePull)), true);
	expect(screen.getByRole("heading", { name: fixturePull.title })).toBeTruthy();
	expect(
		screen.getByRole("status", { name: "Loading the full description" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("status", { name: "Loading PR details" }),
	).toBeNull();
});

it("shows expired build evidence and its next action despite a generic saved Build label", () => {
	const pull = {
		...fixturePull,
		mergeable: "clear" as const,
		builds: [],
		reviewers: [],
		requiredApprovals: 0,
		policies: [
			{
				id: "build-policy",
				name: "PR validation",
				kind: "build" as const,
				definitionId: "42",
				expired: true,
				state: "failed" as const,
				required: true,
				detail: "Queue a new build for the current PR and target branch.",
				owner: "Maintainers",
			},
		],
	};
	const project = {
		...fixtureProject,
		readinessRules: [
			{ gateId: "build:42", label: "Build", color: "blue" as const },
		],
	};
	show(queryRow(publicPull(pull, project)));
	expect(screen.getAllByText("Build Expired").length).toBeGreaterThan(0);
	expect(
		screen.getAllByText(
			"Queue a new build for the current PR and target branch.",
		).length,
	).toBeGreaterThan(0);
	fireEvent.mouseDown(screen.getByRole("tab", { name: /Checks & builds/ }), {
		button: 0,
		ctrlKey: false,
	});
	expect(
		screen.getByRole("region", { name: "Policies" }).textContent,
	).toContain("Build Expired");
});

it.each([
	"open",
	"merged",
	"closed",
] as const)("can remove an active watch from %s PR details", (state) => {
	const onToggleWatch = show(
		queryRow(
			publicPull({ ...fixturePull, state }, undefined, fixtureObservation()),
		),
	);
	const button = screen.getByRole("button", { name: "Stop watching" });
	expect(button).toHaveProperty("disabled", false);
	fireEvent.click(button);
	expect(onToggleWatch).toHaveBeenCalledOnce();
});

it.each([
	"merged",
	"closed",
] as const)("cannot add a new watch from %s PR details", (state) => {
	show(queryRow(publicPull({ ...fixturePull, state })));
	expect(
		screen.queryByRole("button", { name: "Add to watch list" }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Stop watching" })).toBeNull();
});

it("keeps a terminal watch removal visible and disabled while its optimistic request is pending", () => {
	const onToggleWatch = show({
		...queryRow(
			publicPull(
				{ ...fixturePull, state: "merged" },
				undefined,
				fixtureObservation(),
			),
		),
		watching: false,
		watchPending: true,
	});
	const button = screen.getByRole("button", { name: "Stopping…" });
	expect(button).toHaveProperty("disabled", true);
	expect(button.getAttribute("aria-busy")).toBe("true");
	fireEvent.click(button);
	expect(onToggleWatch).not.toHaveBeenCalled();
	expect(
		screen.queryByRole("button", { name: "Add to watch list" }),
	).toBeNull();
});

it("keeps an optimistic watch visible when discovery publishes a terminal snapshot before its receipt", () => {
	show({
		...queryRow(publicPull({ ...fixturePull, state: "closed" })),
		watching: true,
		watchPending: true,
	});
	expect(screen.getByRole("button", { name: "Stop watching" })).toHaveProperty(
		"disabled",
		true,
	);
});
