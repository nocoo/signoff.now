/**
 * The schemas are validated against fixtures captured from a live Azure DevOps
 * instance (see fixtures/raw/README.md), not hand-written examples. A schema
 * that only parses what its author imagined is worse than no schema: it passes
 * in CI and rejects real payloads in the field.
 */

import { describe, expect, test } from "bun:test";
import {
	adoListSchema,
	rawEnvelopeSchema,
	rawIdentitySchema,
	rawIterationSchema,
	rawPrSchema,
	rawThreadSchema,
	rawWiUpdateSchema,
} from "./raw.js";

const fixture = (name: string) =>
	require(`../fixtures/raw/${name}.sample.json`) as {
		count?: number;
		value: unknown[];
	};

describe("raw schemas accept live-captured payloads", () => {
	test("pull requests", () => {
		const parsed = adoListSchema(rawPrSchema).parse(fixture("pr"));
		expect(parsed.value.length).toBeGreaterThan(0);
		const pr = parsed.value[0]!;
		expect(pr.status).toBe("completed");
		expect(pr.closedDate).toBeDefined();
		expect(pr.lastMergeCommit?.commitId).toBeDefined();
		expect(pr.createdBy.uniqueName).toContain("@");
		expect(pr.repository.project.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("threads, including the vote shape the transform depends on", () => {
		const parsed = adoListSchema(rawThreadSchema).parse(fixture("threads"));
		const votes = parsed.value.filter(
			(t) => t.properties?.CodeReviewThreadType?.$value === "VoteUpdate",
		);
		expect(votes.length).toBeGreaterThan(0);

		for (const v of votes) {
			// 07 §6.2.1: exactly one system comment carries the vote's time+author.
			const system = (v.comments ?? []).filter(
				(c) => c.commentType === "system",
			);
			expect(system).toHaveLength(1);
			expect(system[0]?.publishedDate).toBeDefined();
			expect(system[0]?.author?.id).toBeDefined();
			expect(v.properties?.CodeReviewVoteResult?.$value).toBeDefined();
		}
	});

	test("iterations", () => {
		const parsed = adoListSchema(rawIterationSchema).parse(
			fixture("iterations"),
		);
		expect(parsed.value.length).toBeGreaterThan(0);
		expect(parsed.value[0]?.updatedDate).toBeDefined();
		expect(parsed.value[0]?.author?.uniqueName).toBeDefined();
	});

	test("work item updates", () => {
		const parsed = adoListSchema(rawWiUpdateSchema).parse(
			fixture("wi-updates"),
		);
		expect(parsed.value.length).toBeGreaterThan(0);
		expect(parsed.value[0]?.rev).toBeGreaterThan(0);
		expect(parsed.value[0]?.revisedDate).toBeDefined();
	});

	test("container reviewers survive parsing with isContainer intact", () => {
		const parsed = adoListSchema(rawPrSchema).parse(fixture("pr"));
		const reviewers = (parsed.value[0] as { reviewers?: unknown[] }).reviewers;
		const containers = (reviewers ?? [])
			.map((r) => rawIdentitySchema.parse(r))
			.filter((r) => r.isContainer === true);
		expect(containers.length).toBeGreaterThan(0);
		// 01 §4.1: group descriptors are not emails and must be recognisable.
		expect(containers[0]?.uniqueName).not.toContain("@");
	});
});

describe("raw schemas reject payloads the transform cannot use", () => {
	test("unparseable timestamps", () => {
		expect(() =>
			rawIterationSchema.parse({ id: 1, updatedDate: "not-a-date" }),
		).toThrow();
	});

	test("a PR without its repository GUIDs", () => {
		expect(() =>
			rawPrSchema.parse({
				pullRequestId: 1,
				status: "completed",
				creationDate: "2026-07-01T00:00:00Z",
				createdBy: { uniqueName: "a@example.com" },
				repository: { id: "not-a-guid", project: { id: "also-not" } },
			}),
		).toThrow();
	});

	test("a non-positive pull request id", () => {
		expect(() =>
			rawPrSchema.parse({
				pullRequestId: 0,
				status: "active",
				creationDate: "2026-07-01T00:00:00Z",
				createdBy: {},
				repository: {
					id: "11111111-1111-4111-8111-111111111111",
					project: { id: "22222222-2222-4222-8222-222222222222" },
				},
			}),
		).toThrow();
	});

	test("a work item revision without a revision number", () => {
		expect(() =>
			rawWiUpdateSchema.parse({ revisedDate: "2026-07-01T00:00:00Z" }),
		).toThrow();
	});
});

describe("raw envelope", () => {
	test("accepts the documented shape", () => {
		const ok = rawEnvelopeSchema.parse({
			schemaVersion: 1,
			fetchedAt: 1_784_737_800,
			payload: { any: "thing" },
		});
		expect(ok.schemaVersion).toBe(1);
	});

	test("rejects a foreign schema version or extra keys", () => {
		expect(() =>
			rawEnvelopeSchema.parse({ schemaVersion: 2, fetchedAt: 1, payload: {} }),
		).toThrow();
		expect(() =>
			rawEnvelopeSchema.parse({
				schemaVersion: 1,
				fetchedAt: 1,
				payload: {},
				extra: true,
			}),
		).toThrow();
	});
});
