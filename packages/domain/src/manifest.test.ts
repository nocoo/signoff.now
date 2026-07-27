import { describe, expect, test } from "bun:test";
import {
	type Artifact,
	commitScope,
	cursorSchema,
	emptyCursor,
	findArtifactScope,
	isCommitEligible,
	isScopeCommittable,
	type Manifest,
	manifestSchema,
	markArtifactComplete,
	markScopeIncomplete,
	planWindow,
	readCursor,
	type Scope,
} from "./manifest.js";

const artifact = (over: Partial<Artifact> = {}): Artifact => ({
	path: ".data/normalized/a.json",
	runId: "01JRUN0000000000000000000",
	sha256: "abc",
	activityCount: 3,
	status: "pending",
	...over,
});

const scope = (over: Partial<Scope> = {}): Scope => ({
	kind: "repo",
	id: "01K0REPO00000000000000000",
	field: "prsClosedThrough",
	baseCursor: "2026-07-20T00:00:00.000Z",
	from: "2026-07-19T00:00:00.000Z",
	watermark: "2026-07-26T12:00:00.000Z",
	commitEligible: true,
	status: "pending",
	errors: [],
	artifacts: [artifact()],
	...over,
});

const manifest = (scopes: Scope[]): Manifest => ({
	schemaVersion: 1,
	collectRunId: "01JCOLLECT000000000000000",
	startedAt: 1_784_737_800,
	scopes,
});

describe("schemas", () => {
	test("a well-formed manifest and cursor parse", () => {
		expect(() => manifestSchema.parse(manifest([scope()]))).not.toThrow();
		expect(() => cursorSchema.parse(emptyCursor())).not.toThrow();
	});

	test("unknown keys are rejected so a typo cannot be silently ignored", () => {
		expect(() => manifestSchema.parse({ ...manifest([]), extra: 1 })).toThrow();
		expect(() => cursorSchema.parse({ ...emptyCursor(), extra: 1 })).toThrow();
	});
});

describe("isCommitEligible", () => {
	test("a first-ever collection is always eligible", () => {
		expect(isCommitEligible(null, "2026-07-20T00:00:00Z")).toBe(true);
	});

	test("a window reaching back to the cursor is eligible", () => {
		expect(
			isCommitEligible("2026-07-20T00:00:00Z", "2026-07-19T00:00:00Z"),
		).toBe(true);
		expect(
			isCommitEligible("2026-07-20T00:00:00Z", "2026-07-20T00:00:00Z"),
		).toBe(true);
	});

	test("a window starting after the cursor is NOT eligible", () => {
		// This is the hole: cursor at Jul 1, operator runs --since Jul 20.
		// Advancing to the new watermark would skip Jul 1–20 forever.
		expect(
			isCommitEligible("2026-07-01T00:00:00Z", "2026-07-20T00:00:00Z"),
		).toBe(false);
	});

	test("a full re-collection covers everything", () => {
		expect(isCommitEligible("2026-07-01T00:00:00Z", null)).toBe(true);
	});

	test("unparseable dates are not eligible", () => {
		expect(isCommitEligible("nonsense", "2026-07-20T00:00:00Z")).toBe(false);
		expect(isCommitEligible("2026-07-20T00:00:00Z", "nonsense")).toBe(false);
	});
});

describe("planWindow", () => {
	const now = Math.floor(Date.parse("2026-07-26T12:00:00Z") / 1000);

	test("the watermark stops short of now by the safety lag", () => {
		const w = planWindow({ baseCursor: null, nowSeconds: now });
		// ADO indexing is eventually consistent; querying right up to now would
		// miss rows that are written but not yet visible.
		expect(w.watermark).toBe("2026-07-26T11:55:00.000Z");
	});

	test("the window reaches back before the cursor by the overlap", () => {
		const w = planWindow({
			baseCursor: "2026-07-20T00:00:00.000Z",
			nowSeconds: now,
		});
		expect(w.from).toBe("2026-07-19T23:00:00.000Z");
		expect(w.commitEligible).toBe(true);
	});

	test("--since is honoured and marks the run ineligible when it leaves a hole", () => {
		const w = planWindow({
			baseCursor: "2026-07-01T00:00:00.000Z",
			nowSeconds: now,
			since: "2026-07-20T00:00:00.000Z",
		});
		expect(w.from).toBe("2026-07-20T00:00:00.000Z");
		expect(w.commitEligible).toBe(false);
	});

	test("--since that still covers the cursor stays eligible", () => {
		const w = planWindow({
			baseCursor: "2026-07-20T00:00:00.000Z",
			nowSeconds: now,
			since: "2026-07-01T00:00:00.000Z",
		});
		expect(w.commitEligible).toBe(true);
	});

	test("--full ignores the cursor entirely", () => {
		const w = planWindow({
			baseCursor: "2026-07-20T00:00:00.000Z",
			nowSeconds: now,
			full: true,
		});
		expect(w.from).toBeNull();
		expect(w.commitEligible).toBe(true);
	});

	test("a corrupt cursor collects everything rather than skipping history", () => {
		const w = planWindow({ baseCursor: "garbage", nowSeconds: now });
		expect(w.from).toBeNull();
		expect(w.commitEligible).toBe(true);
	});

	test("overlap and lag are configurable", () => {
		const w = planWindow({
			baseCursor: "2026-07-20T00:00:00.000Z",
			nowSeconds: now,
			overlapSeconds: 60,
			safetyLagSeconds: 0,
		});
		expect(w.from).toBe("2026-07-19T23:59:00.000Z");
		expect(w.watermark).toBe("2026-07-26T12:00:00.000Z");
	});
});

describe("isScopeCommittable", () => {
	test("a whole, eligible scope with all artifacts complete", () => {
		expect(
			isScopeCommittable(
				scope({
					status: "complete",
					artifacts: [artifact({ status: "complete" })],
				}),
			),
		).toBe(true);
	});

	test("one pending artifact blocks the whole scope", () => {
		// This is the multi-file case: finalizing file 1 says nothing about 2..N.
		expect(
			isScopeCommittable(
				scope({
					artifacts: [
						artifact({ path: "a", status: "complete" }),
						artifact({ path: "b", status: "pending" }),
					],
				}),
			),
		).toBe(false);
	});

	test("an incomplete scope never commits, even with complete artifacts", () => {
		expect(
			isScopeCommittable(
				scope({
					status: "incomplete",
					errors: ["schema failure"],
					artifacts: [artifact({ status: "complete" })],
				}),
			),
		).toBe(false);
	});

	test("an ineligible scope never commits", () => {
		expect(
			isScopeCommittable(
				scope({
					commitEligible: false,
					artifacts: [artifact({ status: "complete" })],
				}),
			),
		).toBe(false);
	});

	test("a scope with no artifacts does not commit", () => {
		// Nothing was produced, so there is no evidence the window was covered.
		expect(isScopeCommittable(scope({ artifacts: [] }))).toBe(false);
	});

	test("recorded errors block commitment even if status was left pending", () => {
		expect(
			isScopeCommittable(
				scope({
					errors: ["page gap detected"],
					artifacts: [artifact({ status: "complete" })],
				}),
			),
		).toBe(false);
	});
});

describe("commitScope", () => {
	test("a repo scope writes its watermark", () => {
		const c = commitScope(
			emptyCursor(),
			scope({
				status: "complete",
				artifacts: [artifact({ status: "complete" })],
			}),
			"01JCOLLECT000000000000000",
		);
		expect(readCursor(c, { kind: "repo", id: scope().id })).toBe(
			"2026-07-26T12:00:00.000Z",
		);
	});

	test("a project scope writes its own namespace", () => {
		const c = commitScope(
			emptyCursor(),
			scope({
				kind: "project",
				id: "22222222-2222-4222-8222-222222222222",
				field: "wiChangedThrough",
				status: "complete",
				artifacts: [artifact({ status: "complete" })],
			}),
			"01JCOLLECT000000000000000",
		);
		expect(
			readCursor(c, {
				kind: "project",
				id: "22222222-2222-4222-8222-222222222222",
			}),
		).toBe("2026-07-26T12:00:00.000Z");
		expect(Object.keys(c.byRepo)).toHaveLength(0);
	});

	test("a non-committable scope leaves the cursor untouched", () => {
		const before = commitScope(
			emptyCursor(),
			scope({
				status: "complete",
				artifacts: [artifact({ status: "complete" })],
			}),
			"run-1",
		);
		const after = commitScope(
			before,
			scope({ watermark: "2027-01-01T00:00:00.000Z", commitEligible: false }),
			"run-2",
		);
		expect(after).toEqual(before);
	});

	test("a stale watermark never moves the cursor backwards", () => {
		// Crash recovery re-scans .data/meta/runs/, so an OLD manifest can be
		// replayed after a newer one already committed. Rewinding would make the
		// next run re-collect, or stall it as ineligible.
		const done = scope({
			status: "complete",
			artifacts: [artifact({ status: "complete" })],
		});
		const ahead = commitScope(emptyCursor(), done, "run-2");
		const replayed = commitScope(
			ahead,
			{ ...done, watermark: "2026-07-01T00:00:00.000Z" },
			"run-1",
		);
		expect(replayed).toEqual(ahead);
	});

	test("replaying the same watermark is a no-op, not a rewrite", () => {
		const done = scope({
			status: "complete",
			artifacts: [artifact({ status: "complete" })],
		});
		const first = commitScope(emptyCursor(), done, "run-1");
		expect(commitScope(first, done, "run-2")).toEqual(first);
	});

	test("readCursor reports null for a scope never collected", () => {
		expect(readCursor(emptyCursor(), { kind: "repo", id: "x" })).toBeNull();
		expect(readCursor(emptyCursor(), { kind: "project", id: "x" })).toBeNull();
	});
});

describe("artifact bookkeeping", () => {
	test("completing the last artifact completes the scope", () => {
		const m = manifest([
			scope({
				artifacts: [artifact({ path: "a" }), artifact({ path: "b" })],
			}),
		]);
		const one = markArtifactComplete(m, "a");
		expect(one.scopes[0]?.status).toBe("pending");
		const both = markArtifactComplete(one, "b");
		expect(both.scopes[0]?.status).toBe("complete");
	});

	test("completing artifacts cannot resurrect an incomplete scope", () => {
		const m = manifest([
			scope({
				status: "incomplete",
				errors: ["boom"],
				artifacts: [artifact()],
			}),
		]);
		const done = markArtifactComplete(m, ".data/normalized/a.json");
		expect(done.scopes[0]?.status).toBe("incomplete");
		expect(isScopeCommittable(done.scopes[0] as Scope)).toBe(false);
	});

	test("an unknown path changes nothing", () => {
		const m = manifest([scope()]);
		expect(markArtifactComplete(m, "nope")).toEqual(m);
	});

	test("marking incomplete records the reason", () => {
		const m = markScopeIncomplete(manifest([scope()]), scope().id, "429 storm");
		expect(m.scopes[0]?.status).toBe("incomplete");
		expect(m.scopes[0]?.errors).toEqual(["429 storm"]);
	});
});

describe("findArtifactScope", () => {
	test("resolves the owning scope for an artifact path", () => {
		const m = manifest([
			scope({ id: "r1", artifacts: [artifact({ path: "a" })] }),
			scope({ id: "r2", artifacts: [artifact({ path: "b" })] }),
		]);
		expect(findArtifactScope(m, "b")?.scope.id).toBe("r2");
	});

	test("returns null for a file the run did not produce", () => {
		// A hand-dropped file must never be able to advance a cursor.
		expect(findArtifactScope(manifest([scope()]), "stray.json")).toBeNull();
	});
});
