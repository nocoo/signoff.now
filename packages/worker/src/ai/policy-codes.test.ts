import { expect, test } from "bun:test";
import { createSqliteD1 } from "../test/sqlite-d1";
import { numberPolicies } from "./policy-codes";

test("policy codes share exact names, survive renames and preserve scoped evaluations", async () => {
	const sqlite = createSqliteD1();
	try {
		const state = {
			policiesInPriorityOrder: [
				{
					id: "stable-1",
					name: "Build",
					sourceIds: ["source-1"],
					code: "W2",
					description: "inspect failures",
				},
			],
		};
		const first = await numberPolicies(
			sqlite.db,
			"a",
			state.policiesInPriorityOrder,
		);
		expect(first.get("stable-1")).toBe("W2");
		const same = structuredClone(state);
		same.policiesInPriorityOrder[0]!.id = "other";
		expect(
			(await numberPolicies(sqlite.db, "b", same.policiesInPriorityOrder)).get(
				"other",
			),
		).toBe("W2");
		same.policiesInPriorityOrder[0]!.name = "Renamed build";
		expect(
			(await numberPolicies(sqlite.db, "a", same.policiesInPriorityOrder)).get(
				"other",
			),
		).toBe("W2");
		state.policiesInPriorityOrder[0]!.name = "New gate";
		state.policiesInPriorityOrder[0]!.id = "new";
		state.policiesInPriorityOrder[0]!.sourceIds = [];
		const added = await numberPolicies(
			sqlite.db,
			"a",
			state.policiesInPriorityOrder,
		);
		expect(added.get("new")).toMatch(/^P\d+$/);
		expect(
			(await numberPolicies(sqlite.db, "a", state.policiesInPriorityOrder)).get(
				"new",
			),
		).toBe(added.get("new"));
	} finally {
		sqlite.close();
	}
});
