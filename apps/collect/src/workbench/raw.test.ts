import { describe, expect, test } from "bun:test";
import { AdoError } from "../ado/client.ts";
import {
	adoBuildSchema,
	adoBuildTimelineSchema,
	adoEvaluationSchema,
	adoPullRequestDetailSchema,
	adoPullRequestsSchema,
	adoRepositoriesSchema,
	adoStatusSchema,
	adoThreadsSchema,
	parseRaw,
} from "./raw.js";

describe("workbench ADO raw schemas", () => {
	test("parseRaw parses valid payload and throws AdoError on schema violation", () => {
		const valid = parseRaw(
			adoStatusSchema,
			{ id: 1, state: "succeeded" },
			"status test",
		);
		expect(valid.id).toBe(1);

		expect(() =>
			parseRaw(
				adoRepositoriesSchema,
				{ value: "not-an-array" },
				"repositories test",
			),
		).toThrow(AdoError);

		const fakeSchema = {
			parse: () => {
				throw new Error("Generic failure without zod issues");
			},
		};
		expect(() => parseRaw(fakeSchema, {}, "fake schema")).toThrow(
			/Generic failure without zod issues/,
		);
	});

	test("validates repositories list response", () => {
		const raw = {
			value: [
				{
					id: "4195bc9a-3caf-42de-8d21-90aa4b9a2aec",
					name: "whiteboard-app",
					project: {
						id: "044346cd-32fd-479d-ba52-e29c61dcf54f",
						name: "intent",
					},
				},
			],
		};
		const parsed = adoRepositoriesSchema.parse(raw);
		expect(parsed.value).toHaveLength(1);
		expect(parsed.value[0]?.name).toBe("whiteboard-app");
		expect(parsed.value[0]?.project.id).toBe(
			"044346cd-32fd-479d-ba52-e29c61dcf54f",
		);
	});

	test("validates PR list and detail schemas with extended properties", () => {
		const pr = {
			pullRequestId: 59703,
			codeReviewId: 59703,
			status: "active",
			title: "build: version bump to 26.10917 and update TPN",
			description: "Release prep",
			sourceRefName: "refs/heads/user/lina/release-prep-v26.10917",
			targetRefName: "refs/heads/master",
			mergeStatus: "succeeded",
			isDraft: false,
			creationDate: "2026-09-17T01:41:40.222021Z",
			closedDate: null,
			createdBy: {
				id: "c97a1564-bcdb-648f-9b91-7ce726773fdd",
				displayName: "Lorna Li",
				uniqueName: "lina@microsoft.com",
			},
			repository: {
				id: "4195bc9a-3caf-42de-8d21-90aa4b9a2aec",
				name: "whiteboard-app",
				project: {
					id: "044346cd-32fd-479d-ba52-e29c61dcf54f",
					name: "intent",
				},
			},
			lastMergeCommit: {
				commitId: "dfc35ec0c88f0dd4262928bc1ee8a4fdbe0a5c30",
			},
			lastMergeSourceCommit: {
				commitId: "f69792481cdc18dc99ae6dd37b0eb7d289accaca",
			},
			lastMergeTargetCommit: {
				commitId: "e59556524332eef1960371b3494db1bb18fae359",
			},
			reviewers: [
				{
					id: "93b87f80-5390-4a9d-9782-6c56244f308f",
					displayName: "[intent]\\WB Client GateKeepers",
					uniqueName:
						"vstfs:///Classification/TeamProject/044346cd-32fd-479d-ba52-e29c61dcf54f\\WB Client GateKeepers",
					vote: 0,
					isRequired: true,
					isContainer: true,
					votedFor: [],
				},
			],
			labels: [{ id: "l1", name: "release" }],
		};

		const listParsed = adoPullRequestsSchema.parse({ value: [pr] });
		expect(listParsed.value[0]?.pullRequestId).toBe(59703);

		const detailParsed = adoPullRequestDetailSchema.parse(pr);
		expect(detailParsed.title).toBe(
			"build: version bump to 26.10917 and update TPN",
		);
		expect(detailParsed.reviewers?.[0]?.isContainer).toBe(true);
	});

	test("validates policy evaluations schema with settings and context", () => {
		const ev = {
			evaluationId: "ba6d332f-c2b4-4bac-b9fc-e2c34abdf589",
			status: "queued",
			configuration: {
				id: 887,
				type: {
					id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
					displayName: "Minimum number of reviewers",
				},
				isBlocking: true,
				isEnabled: true,
				settings: {
					minimumApproverCount: 2,
					creatorVoteCounts: false,
				},
			},
			context: {
				buildId: 12345,
			},
		};
		const parsed = adoEvaluationSchema.parse(ev);
		expect(parsed.evaluationId).toBe("ba6d332f-c2b4-4bac-b9fc-e2c34abdf589");
		expect(parsed.status).toBe("queued");
		expect(parsed.configuration.isBlocking).toBe(true);
		expect(parsed.configuration.settings?.minimumApproverCount).toBe(2);
		expect(parsed.context?.buildId).toBe(12345);
	});

	test("validates status schema including iterationId", () => {
		const status = {
			id: 10,
			state: "succeeded",
			description: "Coverage passed",
			iterationId: 2,
			context: { genre: "ci", name: "coverage" },
		};
		const parsed = adoStatusSchema.parse(status);
		expect(parsed.id).toBe(10);
		expect(parsed.iterationId).toBe(2);
		expect(parsed.context?.genre).toBe("ci");
	});

	test("validates threads schema with deleted and system comments", () => {
		const threads = {
			value: [
				{
					id: 1,
					status: "active",
					comments: [
						{
							id: 101,
							commentType: "system",
							isDeleted: false,
							content: "Vote changed",
						},
						{
							id: 102,
							commentType: "text",
							isDeleted: true,
							content: "deleted remark",
						},
						{
							id: 103,
							commentType: "text",
							isDeleted: false,
							content: "active comment",
						},
					],
				},
			],
		};
		const parsed = adoThreadsSchema.parse(threads);
		expect(parsed.value[0]?.comments).toHaveLength(3);
	});

	test("validates build and timeline schema", () => {
		const build = {
			id: 753157,
			buildNumber: "20260917.1",
			status: "inProgress",
			result: null,
			definition: { id: 653, name: "whiteboard-app-pr" },
			sourceVersion: "f69792481cdc18dc99ae6dd37b0eb7d289accaca",
			sourceBranch: "refs/pull/59703/merge",
			startTime: "2026-09-17T01:41:46Z",
			finishTime: null,
		};
		const parsedBuild = adoBuildSchema.parse(build);
		expect(parsedBuild.id).toBe(753157);

		const timeline = {
			records: [
				{
					id: "stage-1",
					parentId: null,
					type: "Stage",
					name: "Build and Test",
					state: "inProgress",
					result: null,
					order: 1,
					startTime: "2026-09-17T01:42:00Z",
					finishTime: null,
				},
			],
		};
		const parsedTimeline = adoBuildTimelineSchema.parse(timeline);
		expect(parsedTimeline.records).toHaveLength(1);
	});
});
