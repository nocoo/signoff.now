import { expect, test } from "bun:test";
import {
	batchDecisionState,
	decisionState,
} from "@signoff/domain/ai-readiness";
import { demoWorkspace } from "@signoff/domain/demo";
import { createSqliteD1 } from "../test/sqlite-d1";
import { numberPolicies } from "./policy-codes";

test("policy codes share exact names, survive renames and preserve scoped evaluations", async () => {
	const sqlite = createSqliteD1();
	try {
		const demo = demoWorkspace(1800000000),
			project = demo.projects[0]!,
			pull = demo.pullRequests[0]!;
		const state = decisionState(pull, project, 1800000000);
		state.policiesInPriorityOrder = [
			{
				id: "stable-1",
				name: "Build",
				sourceIds: ["source-1"],
				code: "W2",
				description: "inspect failures",
			},
		];
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
		const batch = batchDecisionState([same, same]);
		expect(Object.keys(batch.definitions)).toEqual(["W2"]);
		expect(JSON.stringify(batch.definitions)).not.toContain("C1");
		expect(batch.prs[0]?.policies).toHaveLength(same.policies.length);
	} finally {
		sqlite.close();
	}
});
