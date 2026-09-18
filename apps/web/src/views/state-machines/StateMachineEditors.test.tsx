import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { machineFixture } from "@/test/state-machine-fixture";
import {
	GatesEditor,
	MappingsEditor,
	StatesEditor,
} from "./StateMachineEditors";

afterEach(cleanup);
function Harness({ tab }: { tab: "gates" | "states" | "mappings" }) {
	const [config, onChange] = useState(machineFixture().config);
	const Editor =
		tab === "gates"
			? GatesEditor
			: tab === "states"
				? StatesEditor
				: MappingsEditor;
	return (
		<>
			<Editor config={config} onChange={onChange} />
			<output data-testid="config">{JSON.stringify(config)}</output>
		</>
	);
}
it("moves concurrent gate priority and edits presentation without deleting evidence", () => {
	render(<Harness tab="gates" />);
	const before = machineFixture().config;
	const first = before.gates[0]!;
	fireEvent.click(
		screen.getByRole("button", { name: `Move ${first.label} down` }),
	);
	fireEvent.change(screen.getByLabelText(`${first.gateId} display name`), {
		target: { value: "Build first" },
	});
	const after = JSON.parse(screen.getByTestId("config").textContent!);
	expect(after.gates[1]).toMatchObject({
		gateId: first.gateId,
		label: "Build first",
	});
	expect(after.priority).toBe("gate");
	expect(after.states).toEqual(before.states);
	expect(after.mappings).toEqual(before.mappings);
});
it("keeps built-in states protected and lets custom states be created and removed", () => {
	render(<Harness tab="states" />);
	expect(screen.queryByRole("button", { name: "Delete ready" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Add state" }));
	expect(screen.getByDisplayValue("New state")).toBeTruthy();
	const state = JSON.parse(screen.getByTestId("config").textContent!).states.at(
		-1,
	);
	fireEvent.click(screen.getByRole("button", { name: `Delete ${state.id}` }));
	expect(
		JSON.parse(screen.getByTestId("config").textContent!).states,
	).toHaveLength(9);
});
it("adds ordered mappings with typed conditions and removes only the chosen mapping", () => {
	render(<Harness tab="mappings" />);
	const before = machineFixture().config.mappings;
	fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
	const after = JSON.parse(screen.getByTestId("config").textContent!);
	expect(after.mappings[0]).toMatchObject({
		match: "all",
		conditions: [{ fact: "lifecycle", oneOf: ["open"] }],
	});
	fireEvent.click(
		screen.getByRole("button", {
			name: `Delete mapping ${after.mappings[0].id}`,
		}),
	);
	expect(
		JSON.parse(screen.getByTestId("config").textContent!).mappings,
	).toEqual(before);
});
