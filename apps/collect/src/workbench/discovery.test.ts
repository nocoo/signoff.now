import { expect, test } from "bun:test";
import { demoWorkspace } from "@signoff/domain/demo";
import type { AdoPagedClient } from "../ado/client";
import { discoverRepositoryPulls } from "./ado";

const project = demoWorkspace(1789646400).projects[0]!;
const repository = {
	id: "repo-guid",
	name: "web-app",
	projectGuid: "project-guid",
};
const raw = (n: number) => ({
	pullRequestId: n,
	title: `PR ${n}`,
	status: n === 1 ? "active" : n === 2 ? "abandoned" : "completed",
	isDraft: n === 1,
	creationDate: "2026-08-01T00:00:00Z",
	closedDate: n > 1 ? "2026-09-01T00:00:00Z" : undefined,
	createdBy: { id: "author", displayName: "Author" },
	sourceRefName: "refs/heads/feature",
	targetRefName: "refs/heads/main",
	repository: {
		...repository,
		project: { id: repository.projectGuid, name: project.projectKey },
	},
});
test("explicit discovery pages every state, includes old completed PRs, and never loads checks", async () => {
	const calls: URL[] = [];
	const client = {
		getPage: async (value: string) => {
			const url = new URL(value);
			calls.push(url);
			const skip = Number(url.searchParams.get("$skip"));
			return {
				data: {
					value: Array.from({ length: Math.min(100, 125 - skip) }, (_, i) =>
						raw(skip + i + 1),
					),
				},
				continuationToken: null,
			};
		},
	} satisfies Pick<AdoPagedClient, "getPage">;
	const pulls = [];
	for await (const page of discoverRepositoryPulls(
		client,
		project,
		repository,
		1789646400,
	))
		pulls.push(...page);
	expect(pulls).toHaveLength(125);
	expect(pulls[0]).toMatchObject({
		draft: true,
		state: "open",
		checksObservedAt: null,
	});
	expect(pulls[1]).toMatchObject({ state: "closed", mergedAt: null });
	expect(pulls[124]).toMatchObject({
		state: "merged",
		mergedAt: Date.parse("2026-09-01T00:00:00Z") / 1000,
	});
	expect(
		calls.map((url) => url.searchParams.get("searchCriteria.status")),
	).toEqual(["all", "all"]);
	expect(calls.every((url) => url.pathname.endsWith("/pullrequests"))).toBe(
		true,
	);
});
test("discovery follows continuation pages and rejects cycles or foreign repository facts", async () => {
	let count = 0;
	const client: Pick<AdoPagedClient, "getPage"> = {
		getPage: async () => ({
			data: { value: [raw(++count)] },
			continuationToken: "same",
		}),
	};
	const read = async () => {
		for await (const _page of discoverRepositoryPulls(
			client,
			project,
			repository,
			1789646400,
		)) {
			/* consume pages */
		}
	};
	await expect(read()).rejects.toThrow(/token/i);
	count = 0;
	client.getPage = async () => ({
		data: {
			value: [
				{ ...raw(1), repository: { ...raw(1).repository, id: "foreign" } },
			],
		},
		continuationToken: null,
	});
	await expect(read()).rejects.toThrow(/identity/i);
});

test("incremental discovery uses a successful creation boundary with overlap, independent of page order", async () => {
	const createdAt = Date.parse("2026-08-02T00:00:00Z") / 1000;
	const history = Array.from({ length: 1000 }, (_, i) => ({
		...raw(i + 1),
		creationDate: new Date((createdAt - 1000 + i) * 1000).toISOString(),
	}));
	const recent = [
		{ ...raw(1001), creationDate: new Date(createdAt * 1000).toISOString() },
		{
			...raw(1003),
			creationDate: new Date((createdAt + 1) * 1000).toISOString(),
		},
		{ ...raw(1002), creationDate: new Date(createdAt * 1000).toISOString() },
	];
	let calls = 0;
	const pulls = [];
	for await (const page of discoverRepositoryPulls(
		{
			getPage: async (value) => {
				calls++;
				const url = new URL(value);
				expect(url.searchParams.get("searchCriteria.status")).toBe("all");
				expect(url.searchParams.get("searchCriteria.queryTimeRangeType")).toBe(
					"created",
				);
				const since = Date.parse(
					url.searchParams.get("searchCriteria.minTime")!,
				);
				expect(since).toBe((createdAt - 1) * 1000);
				const values = [...recent, ...history].filter(
					(pull) => Date.parse(pull.creationDate) > since,
				);
				const skip = Number(url.searchParams.get("$skip"));
				return {
					data: { value: values.slice(skip, skip + 100) },
					continuationToken: null,
				};
			},
		},
		project,
		repository,
		1789646400,
		{ number: 1001, createdAt },
	))
		pulls.push(...page);
	expect(calls).toBe(1);
	expect(pulls.map((pull) => pull.number)).toEqual([1001, 1003, 1002]);
});

test("a deleted boundary PR does not require scanning old history and continuation pages keep the boundary", async () => {
	const boundary = {
		number: 1001,
		createdAt: Date.parse("2026-08-02T00:00:00Z") / 1000,
	};
	const seen: number[] = [];
	let calls = 0;
	for await (const page of discoverRepositoryPulls(
		{
			getPage: async (value) => {
				const url = new URL(value);
				expect(url.searchParams.get("searchCriteria.minTime")).toBe(
					new Date((boundary.createdAt - 1) * 1000).toISOString(),
				);
				return {
					data: { value: [raw(++calls + 1001)] },
					continuationToken: calls === 1 ? "next" : null,
				};
			},
		},
		project,
		repository,
		1789646400,
		boundary,
	))
		seen.push(...page.map((pull) => pull.number));
	expect(seen).toEqual([1002, 1003]);
});

test("overlapping provider pages fail rather than advancing past a moving list", async () => {
	const read = async () => {
		for await (const _page of discoverRepositoryPulls(
			{
				getPage: async () => ({
					data: { value: [raw(10)] },
					continuationToken: "next",
				}),
			},
			project,
			repository,
			1789646400,
			{ number: 9, createdAt: 1 },
		)) {
			/* consume */
		}
	};
	await expect(read()).rejects.toThrow(/Repeated PR while paging/);
});
test.each([
	undefined,
	"invalid date",
])("invalid creation dates (%s) cannot establish an incremental boundary", async (creationDate) => {
	const read = async () => {
		for await (const _page of discoverRepositoryPulls(
			{
				getPage: async () => ({
					data: { value: [{ ...raw(1), creationDate }] },
					continuationToken: null,
				}),
			},
			project,
			repository,
			1789646400,
		)) {
			/* consume */
		}
	};
	await expect(read()).rejects.toThrow(/creation date/i);
});
