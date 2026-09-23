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
test("deep discovery pages every state within ninety days and never loads checks", async () => {
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

test("each list refresh includes old PR state changes without per-PR requests", async () => {
	let merged = false;
	const urls: string[] = [];
	const client = {
		getPage: async (url: string) => {
			urls.push(url);
			return {
				data: {
					value: [{ ...raw(1), status: merged ? "completed" : "active" }],
				},
				continuationToken: null,
			};
		},
	};
	const read = async () => {
		const result = [];
		for await (const page of discoverRepositoryPulls(
			client,
			project,
			repository,
			1789646400,
		))
			result.push(...page);
		return result;
	};
	expect((await read())[0]?.state).toBe("open");
	merged = true;
	expect((await read())[0]?.state).toBe("merged");
	expect(urls).toHaveLength(2);
	expect(
		urls.every((url) =>
			new URL(url).searchParams.has("searchCriteria.minTime"),
		),
	).toBe(true);
});

test("provider date filtering is enforced locally and smart refresh uses its recent boundary", async () => {
	const now = 1789646400;
	const urls: URL[] = [];
	const client = {
		getPage: async (value: string) => {
			urls.push(new URL(value));
			return {
				data: {
					value: [1, 20, 45, 89, 91, -1].map((days, index) => ({
						...raw(index + 1),
						creationDate: new Date((now - days * 86400) * 1000).toISOString(),
					})),
				},
				continuationToken: null,
			};
		},
	};
	const counts: number[] = [];
	for (const days of [90, 30]) {
		const pulls = [];
		for await (const page of discoverRepositoryPulls(
			client,
			project,
			repository,
			now,
			now - days * 86400,
		))
			pulls.push(...page);
		counts.push(pulls.length);
	}
	expect(counts).toEqual([4, 2]);
	expect(
		urls.map((url) => url.searchParams.get("searchCriteria.minTime")),
	).toEqual(
		[90, 30].map((days) => new Date((now - days * 86400) * 1000).toISOString()),
	);
	expect(
		urls.every(
			(url) => url.searchParams.get("searchCriteria.status") === "all",
		),
	).toBe(true);
});

const smartNow = 1789646400;
const cachedBefore = smartNow - 86400;
const datedRaw = (id: number, createdAt: number) => ({
	...raw(id),
	creationDate: new Date(createdAt * 1000).toISOString(),
});
async function readSmart(pages: ReturnType<typeof datedRaw>[][]) {
	let calls = 0;
	const pulls = [];
	for await (const page of discoverRepositoryPulls(
		{
			getPage: async () => {
				const value = pages[calls++] ?? [];
				return {
					data: { value },
					continuationToken: calls < pages.length ? String(calls) : null,
				};
			},
		},
		project,
		repository,
		smartNow,
		smartNow - 30 * 86400,
		cachedBefore,
	))
		pulls.push(...page);
	return { calls, pulls };
}

test("smart discovery refreshes the first page and reuses the successfully cached history", async () => {
	const first = Array.from({ length: 100 }, (_, n) =>
		datedRaw(n + 1, cachedBefore - n - 1),
	);
	const result = await readSmart([first, [datedRaw(101, cachedBefore - 200)]]);
	expect(result.calls).toBe(1);
	expect(result.pulls).toHaveLength(100);
	expect(result.pulls[1]?.state).toBe("closed");
});

test("smart discovery drains more than one page of new PRs before the cached boundary", async () => {
	const first = Array.from({ length: 100 }, (_, n) =>
		datedRaw(n + 1, smartNow - n),
	);
	const second = Array.from({ length: 100 }, (_, n) =>
		datedRaw(n + 101, n < 25 ? smartNow - 100 - n : cachedBefore - n),
	);
	const result = await readSmart([
		first,
		second,
		[datedRaw(201, cachedBefore - 300)],
	]);
	expect(result.calls).toBe(2);
	expect(result.pulls).toHaveLength(200);
	expect(
		result.pulls.filter((pull) => pull.createdAt > cachedBefore),
	).toHaveLength(125);
});

test("smart discovery drains timestamp ties and disables early stopping for unordered pages", async () => {
	const tied = await readSmart([
		[datedRaw(1, cachedBefore), datedRaw(2, cachedBefore)],
		[datedRaw(3, cachedBefore), datedRaw(4, cachedBefore - 1)],
		[datedRaw(5, cachedBefore - 2)],
	]);
	expect(tied.calls).toBe(2);
	expect(tied.pulls.map((pull) => pull.number)).toEqual([1, 2, 3, 4]);
	const unordered = await readSmart([
		[datedRaw(1, cachedBefore - 10), datedRaw(2, smartNow - 1)],
		[datedRaw(3, cachedBefore - 20)],
		[datedRaw(4, smartNow - 2)],
	]);
	expect(unordered.calls).toBe(3);
	expect(unordered.pulls.map((pull) => pull.number)).toEqual([1, 2, 3, 4]);
});
