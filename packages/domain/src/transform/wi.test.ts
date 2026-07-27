import { describe, expect, test } from "bun:test";
import { activitySchema } from "../activity.js";
import { buildExternalRef } from "../external-ref.js";
import type { RawWiUpdate, RawWorkItem } from "../raw.js";
import {
	chooseRevisionRecord,
	groupByRev,
	isClosingRevision,
	transformWorkItems,
	type WiTransformInput,
} from "./wi.js";

const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const DEV_ID = "01K0DEV000000000000000000";

/** Mirrors the live Bug workflow: New/Approved→Proposed, Done→Completed. */
const bugStates = new Map([
	["New", "Proposed"],
	["Approved", "Proposed"],
	["Committed", "InProgress"],
	["Done", "Completed"],
	["Removed", "Removed"],
]);

const common = {
	settings: { emailSuffixes: ["example.com"] },
	developers: [{ id: DEV_ID, alias: "ada" }],
	org: "acme",
	project: "Alpha",
	projectExternalId: PROJ_GUID,
	stateCategories: new Map([["Bug", bugStates]]),
};

function input(over: Partial<WiTransformInput> = {}): WiTransformInput {
	return {
		...common,
		workItems: [],
		updatesByWi: new Map(),
		...over,
	} as WiTransformInput;
}

function wi(over: Record<string, unknown> = {}): RawWorkItem {
	return {
		id: 4016916,
		fields: {
			"System.WorkItemType": "Bug",
			"System.CreatedDate": "2024-09-10T11:26:30.84Z",
			"System.CreatedBy": { uniqueName: "ada@example.com", id: "aid" },
			"System.State": "New",
			...(over.fields as Record<string, unknown>),
		},
		...over,
	} as RawWorkItem;
}

const update = (over: Partial<RawWiUpdate> = {}): RawWiUpdate =>
	({
		rev: 2,
		revisedDate: "2024-11-10T16:44:56.473Z",
		revisedBy: { uniqueName: "ada@example.com", id: "aid" },
		...over,
	}) as RawWiUpdate;

describe("isClosingRevision", () => {
	test("ClosedDate going empty → set is a closure", () => {
		const u = update({
			fields: {
				"Microsoft.VSTS.Common.ClosedDate": {
					newValue: "2024-11-09T16:40:44.683Z",
				},
			},
		});
		expect(isClosingRevision(u, "Bug", common.stateCategories)).toBe(true);
	});

	test("a ClosedDate that was already set is not a new closure", () => {
		const u = update({
			fields: {
				"Microsoft.VSTS.Common.ClosedDate": {
					oldValue: "2024-10-01T00:00:00Z",
					newValue: "2024-11-09T16:40:44.683Z",
				},
			},
		});
		expect(isClosingRevision(u, "Bug", common.stateCategories)).toBe(false);
	});

	test("falls back to the state CATEGORY, not the state name", () => {
		const u = update({
			fields: { "System.State": { oldValue: "New", newValue: "Done" } },
		});
		expect(isClosingRevision(u, "Bug", common.stateCategories)).toBe(true);

		// The same transition is meaningless without the category map — this is
		// why the caller must supply it rather than the code guessing names.
		expect(isClosingRevision(u, "Bug", new Map())).toBe(false);
		expect(isClosingRevision(u, null, common.stateCategories)).toBe(false);
	});

	test("a move within closed categories is not a second closure", () => {
		const states = new Map([
			["Done", "Completed"],
			["Resolved", "Resolved"],
		]);
		const u = update({
			fields: { "System.State": { oldValue: "Resolved", newValue: "Done" } },
		});
		expect(isClosingRevision(u, "Bug", new Map([["Bug", states]]))).toBe(false);
	});

	test("non-closing edits are not closures", () => {
		expect(isClosingRevision(update(), "Bug", common.stateCategories)).toBe(
			false,
		);
		expect(
			isClosingRevision(
				update({
					fields: {
						"System.State": { oldValue: "New", newValue: "Committed" },
					},
				}),
				"Bug",
				common.stateCategories,
			),
		).toBe(false);
	});
});

describe("work item activities", () => {
	test("wi.created comes from the item's own fields", () => {
		const r = transformWorkItems(input({ workItems: [wi()] }));
		expect(r.activities).toHaveLength(1);
		const a = r.activities[0]!;
		expect(a.type).toBe("wi.created");
		// Work items are project-scoped, so no repo may be attributed.
		expect(a.repoId).toBeNull();
		expect(a.sourceIds).toEqual({ projectGuid: PROJ_GUID, wiId: 4016916 });
	});

	test("wi.updated is emitted per revision, skipping the creation revision", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[update({ rev: 1 }), update({ rev: 2 }), update({ rev: 3 })],
					],
				]),
			}),
		);
		const updates = r.activities.filter((a) => a.type === "wi.updated");
		// rev 1 IS the creation; counting it would double-count wi.created.
		expect(
			updates.map((a) => (a.sourceIds as { revisionId: number }).revisionId),
		).toEqual([2, 3]);
	});

	test("wi.closed uses the closing revision's time and author", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({ rev: 2 }),
							update({
								rev: 16,
								revisedDate: "2024-11-10T16:44:56.473Z",
								revisedBy: { uniqueName: "ada@example.com", id: "aid" },
								fields: {
									"System.State": { oldValue: "New", newValue: "Done" },
									"Microsoft.VSTS.Common.ClosedDate": {
										newValue: "2024-11-09T16:40:44.683Z",
									},
								},
							}),
						],
					],
				]),
			}),
		);
		const closed = r.activities.find((a) => a.type === "wi.closed")!;
		expect(closed).toBeDefined();
		// The REVISION time, not the ClosedDate field — the revision is when the
		// person acted.
		expect(closed.occurredAt).toBe(
			Math.floor(Date.parse("2024-11-10T16:44:56.473Z") / 1000),
		);
	});

	test("reopen then reclose still yields exactly one wi.closed, the earliest", () => {
		const closeAt = (rev: number, date: string) =>
			update({
				rev,
				revisedDate: date,
				fields: {
					"System.State": { oldValue: "New", newValue: "Done" },
					"Microsoft.VSTS.Common.ClosedDate": { newValue: date },
				},
			});
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							closeAt(5, "2024-10-01T00:00:00Z"),
							update({
								rev: 6,
								fields: {
									"System.State": { oldValue: "Done", newValue: "New" },
								},
							}),
							closeAt(7, "2024-12-01T00:00:00Z"),
						],
					],
				]),
			}),
		);
		const closures = r.activities.filter((a) => a.type === "wi.closed");
		// The frozen external_ref allows one closure per work item; emitting the
		// later one too would overwrite the row nondeterministically.
		expect(closures).toHaveLength(1);
		expect(closures[0]?.occurredAt).toBe(
			Math.floor(Date.parse("2024-10-01T00:00:00Z") / 1000),
		);
	});

	test("duplicate revs resolve to the record that changed something", () => {
		// Live data really contains this: several update records share a `rev`,
		// one carrying the field diff and the others empty (link/relation
		// updates). Both build the SAME external_ref, so only one may be
		// emitted. Measured on real work items, the EARLIEST record was the
		// empty one every time — so choosing by timestamp attributes the
		// revision to the wrong developer with a date months off.
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({
								id: 125,
								rev: 23,
								revisedDate: "2026-07-16T10:00:00Z",
								revisedBy: { uniqueName: "ada@example.com", id: "a" },
								fields: { "System.State": { newValue: "Done" } },
							}),
							update({
								id: 126,
								rev: 23,
								revisedDate: "2026-03-25T09:00:00Z",
								revisedBy: { uniqueName: "bob@example.com", id: "b" },
							}),
						],
					],
				]),
			}),
		);
		const updates = r.activities.filter((a) => a.type === "wi.updated");
		expect(updates).toHaveLength(1);
		expect(updates[0]?.occurredAt).toBe(
			Math.floor(Date.parse("2026-07-16T10:00:00Z") / 1000),
		);
		expect(updates[0]?.developerId).toBe(DEV_ID);

		const refs = r.activities.map((a) => buildExternalRef(a.type, a.sourceIds));
		expect(new Set(refs).size).toBe(refs.length);
	});

	test("identical transport records are deduped by update id", () => {
		const same = {
			rev: 5,
			revisedDate: "2026-07-16T10:00:00Z",
			revisedBy: { uniqueName: "ada@example.com", id: "a" },
			fields: { "System.State": { newValue: "Done" } },
		};
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[4016916, [update({ id: 9, ...same }), update({ id: 9, ...same })]],
				]),
			}),
		);
		expect(r.activities.filter((a) => a.type === "wi.updated")).toHaveLength(1);
	});

	test("two substantive records disagreeing is an anomaly, not a guess", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({
								id: 1,
								rev: 7,
								revisedDate: "2026-07-16T10:00:00Z",
								revisedBy: { uniqueName: "ada@example.com", id: "a" },
								fields: { "System.State": { newValue: "Done" } },
							}),
							update({
								id: 2,
								rev: 7,
								revisedDate: "2026-07-17T10:00:00Z",
								revisedBy: { uniqueName: "ada@example.com", id: "a" },
								fields: { "System.Title": { newValue: "x" } },
							}),
						],
					],
				]),
			}),
		);
		// Attributing one arbitrarily would be silent corruption.
		expect(r.activities.filter((a) => a.type === "wi.updated")).toHaveLength(0);
		expect(r.anomalies).toHaveLength(1);
		expect(r.anomalies[0]).toContain("rev 7");
	});

	test("all-placeholder revs still emit deterministically by lowest id", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({ id: 20, rev: 8, revisedDate: "2026-07-18T00:00:00Z" }),
							update({ id: 19, rev: 8, revisedDate: "2026-07-17T00:00:00Z" }),
						],
					],
				]),
			}),
		);
		const updates = r.activities.filter((a) => a.type === "wi.updated");
		expect(updates).toHaveLength(1);
		expect(updates[0]?.occurredAt).toBe(
			Math.floor(Date.parse("2026-07-17T00:00:00Z") / 1000),
		);
	});

	test("revisions are ordered by rev regardless of input order", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[update({ rev: 5 }), update({ rev: 2 }), update({ rev: 3 })],
					],
				]),
			}),
		);
		expect(
			r.activities
				.filter((a) => a.type === "wi.updated")
				.map((a) => (a.sourceIds as { revisionId: number }).revisionId),
		).toEqual([2, 3, 5]);
	});
});

describe("discard rules", () => {
	test("a revision without a timestamp is dropped, not dated by proxy", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[4016916, [update({ rev: 2, revisedDate: null })]],
				]),
			}),
		);
		expect(r.activities.some((a) => a.type === "wi.updated")).toBe(false);
		expect(r.skipped.no_timestamp).toBe(1);
	});

	test("a container reviser is skipped without polluting unmatched", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({
								rev: 2,
								revisedBy: { uniqueName: "vstfs:///Group", isContainer: true },
							}),
						],
					],
				]),
			}),
		);
		expect(r.skipped.container).toBe(1);
		expect(r.unmatched).toHaveLength(0);
	});

	test("an unknown human is reported once as unmatched", () => {
		const r = transformWorkItems(
			input({
				workItems: [
					wi({
						fields: { "System.CreatedBy": { uniqueName: "bob@example.com" } },
					}),
				],
				updatesByWi: new Map([
					[
						4016916,
						[update({ rev: 2, revisedBy: { uniqueName: "bob@example.com" } })],
					],
				]),
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.unmatched).toHaveLength(1);
		expect(r.skipped.unmatched).toBe(2);
	});

	test("a work item without a creation date yields no wi.created", () => {
		// Keep a matchable author so the drop is attributable to the missing
		// timestamp, not to identity resolution.
		const r = transformWorkItems(
			input({
				workItems: [
					wi({
						fields: {
							"System.CreatedDate": null,
							"System.CreatedBy": { uniqueName: "ada@example.com", id: "aid" },
						},
					}),
				],
			}),
		);
		expect(r.activities).toHaveLength(0);
		expect(r.skipped.no_timestamp).toBe(1);
	});
});

describe("output validity", () => {
	test("everything emitted satisfies the frozen wire schema", () => {
		const r = transformWorkItems(
			input({
				workItems: [wi()],
				updatesByWi: new Map([
					[
						4016916,
						[
							update({ rev: 2 }),
							update({
								rev: 3,
								fields: {
									"Microsoft.VSTS.Common.ClosedDate": {
										newValue: "2024-11-09T16:40:44.683Z",
									},
								},
							}),
						],
					],
				]),
			}),
		);
		expect(r.activities.length).toBeGreaterThan(2);
		for (const a of r.activities) {
			expect(() => activitySchema.parse(a)).not.toThrow();
			expect(() => buildExternalRef(a.type, a.sourceIds)).not.toThrow();
		}
		const refs = r.activities.map((a) => buildExternalRef(a.type, a.sourceIds));
		expect(new Set(refs).size).toBe(refs.length);
	});

	test("an empty input produces an empty, well-formed result", () => {
		const r = transformWorkItems(input());
		expect(r.activities).toEqual([]);
		expect(r.unmatched).toEqual([]);
		expect(Object.values(r.skipped).every((n) => n === 0)).toBe(true);
	});
});

describe("revision grouping helpers", () => {
	test("groupByRev returns revisions in ascending order", () => {
		const g = groupByRev([
			update({ id: 1, rev: 5 }),
			update({ id: 2, rev: 2 }),
			update({ id: 3, rev: 5 }),
		]);
		expect([...g.keys()]).toEqual([2, 5]);
		expect(g.get(5)).toHaveLength(2);
	});

	test("a lone record is chosen as-is", () => {
		const u = update({ id: 1, rev: 3 });
		expect(chooseRevisionRecord([u])).toEqual({ kind: "chosen", update: u });
	});

	test("the record with a field diff wins over placeholders", () => {
		const substantive = update({
			id: 2,
			fields: { "System.State": { newValue: "Done" } },
		});
		const placeholder = update({ id: 1 });
		const r = chooseRevisionRecord([placeholder, substantive]);
		expect(r).toEqual({ kind: "chosen", update: substantive });
	});

	test("agreeing substantive records collapse by lowest id", () => {
		const shared = {
			revisedDate: "2026-07-16T10:00:00Z",
			revisedBy: { uniqueName: "ada@example.com", id: "a" },
			fields: { "System.State": { newValue: "Done" } },
		};
		const r = chooseRevisionRecord([
			update({ id: 9, ...shared }),
			update({ id: 4, ...shared }),
		]);
		expect(r.kind).toBe("chosen");
		if (r.kind === "chosen") {
			expect(r.update.id).toBe(4);
		}
	});

	test("disagreeing substantive records are ambiguous", () => {
		const r = chooseRevisionRecord([
			update({
				id: 1,
				revisedBy: { uniqueName: "ada@example.com", id: "a" },
				fields: { a: { newValue: 1 } },
			}),
			update({
				id: 2,
				revisedBy: { uniqueName: "bob@example.com", id: "b" },
				fields: { b: { newValue: 2 } },
			}),
		]);
		expect(r.kind).toBe("ambiguous");
	});

	test("all placeholders resolve to the lowest id", () => {
		const r = chooseRevisionRecord([update({ id: 7 }), update({ id: 3 })]);
		expect(r.kind).toBe("chosen");
		if (r.kind === "chosen") {
			expect(r.update.id).toBe(3);
		}
	});

	test("records without ids still resolve deterministically", () => {
		const r = chooseRevisionRecord([
			update({ id: undefined, rev: 4 }),
			update({ id: undefined, rev: 4 }),
		]);
		expect(r.kind).toBe("chosen");
	});
});
