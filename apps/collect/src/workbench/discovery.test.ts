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
		urls.every(
			(url) => !new URL(url).searchParams.has("searchCriteria.minTime"),
		),
	).toBe(true);
});
