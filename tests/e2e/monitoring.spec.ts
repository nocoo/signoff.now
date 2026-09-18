import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { createCollectionClient } from "../../apps/collect/src/workbench/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import { demoWorkspace } from "../../packages/domain/src/demo";
import {
	batchCommandSchema,
	collectorQuerySchema,
	commandReceiptSchema,
	observationListSchema,
	pullDetailSchema,
	pullListSchema,
	repoListSchema,
} from "../../packages/domain/src/query";
import { projectSchema } from "../../packages/domain/src/workbench";

const base = process.env.SIGNOFF_E2E_API_BASE!;
const marker = JSON.parse(
	readFileSync(process.env.SIGNOFF_E2E_MARKER!, "utf8"),
);
if (
	marker.runId !== process.env.SIGNOFF_E2E_RUN_ID ||
	!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)
)
	throw new Error("E2E state ownership mismatch");
const bun = process.env.SIGNOFF_E2E_BUN!;
const root = path.resolve(import.meta.dirname, "../..");
const repos = [
	{
		org: "e2e-one",
		project: "Alpha",
		id: "repository-one",
		name: "alpha",
		projectGuid: "project-guid-one",
	},
	{
		org: "e2e-two",
		project: "Équipe",
		id: "repository-two",
		name: "Éditeur",
		projectGuid: "project-guid-two",
	},
];
const repoUrl = (r: (typeof repos)[number]) =>
	`https://dev.azure.com/${r.org}/${encodeURIComponent(r.project)}/_git/${encodeURIComponent(r.name)}`;
const now = Math.floor(Date.now() / 1000);
const api = createCollectionClient({ apiBase: base });
let providerRequests = 0;
const fakeAdo: AdoPagedClient = {
	checkAuth: async () => {
		providerRequests++;
	},
	invalidateToken: () => {},
	post: async () => {
		throw new Error("Unexpected provider POST");
	},
	get: async () => {
		throw new Error("Unexpected provider GET");
	},
	getPage: async (value) => {
		providerRequests++;
		const url = new URL(value);
		const r = repos.find((repo) => url.pathname.includes(`/${repo.org}/`))!;
		if (url.pathname.endsWith("/repositories"))
			return {
				data: {
					value: [
						{
							id: r.id,
							name: r.name,
							project: { id: r.projectGuid, name: r.project },
						},
					],
				},
				continuationToken: null,
			};
		if (url.pathname.endsWith("/configurations"))
			return { data: { value: [] }, continuationToken: null };
		expect(url.searchParams.get("searchCriteria.status")).toBe("all");
		return {
			data: {
				value: Array.from({ length: 26 }, (_, i) => ({
					pullRequestId: i + 1,
					title: `${r.name} change ${i + 1}`,
					description: `## Change ${i + 1}\n\n**Ready for review**`,
					status: i === 2 ? "completed" : i === 3 ? "abandoned" : "active",
					isDraft: i === 1,
					creationDate: new Date((now - 86400) * 1000).toISOString(),
					closedDate:
						i === 2 || i === 3
							? new Date((now - 60) * 1000).toISOString()
							: undefined,
					createdBy: { id: "author-one", displayName: "Ada Lovelace" },
					sourceRefName: "refs/heads/feature",
					targetRefName: "refs/heads/main",
					lastMergeSourceCommit: { commitId: "head" },
					lastMergeTargetCommit: { commitId: "target" },
					repository: {
						id: r.id,
						name: r.name,
						project: { id: r.projectGuid, name: r.project },
					},
				})),
			},
			continuationToken: null,
		};
	},
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };
async function cli(...args: string[]) {
	const child = spawn(
		bun,
		[path.join(root, "apps/collect/src/main.ts"), "--api-base", base, ...args],
		{
			cwd: marker.directory,
			env: { ...process.env, NODE_ENV: "test", PATH: "/nonexistent" },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (v) => {
		stdout += v;
	});
	child.stderr.on("data", (v) => {
		stderr += v;
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	expect(code, stderr).toBe(0);
	return JSON.parse(stdout);
}
async function watchList() {
	return observationListSchema.parse(await cli("watch", "list", "--all"));
}
async function execute(merged = false) {
	return runCollectionOnce({
		api,
		makeAdo: () => fakeAdo,
		log: silent,
		collect: async (options) => {
			const target = options.targets![0]!;
			const repository = repos.find(
				(repo) => repo.id === target.repository.id,
			)!;
			const template = demoWorkspace(now).pullRequests[0]!;
			return {
				state: "complete",
				message: "Synthetic provider result",
				pulls: [
					{
						...template,
						...target,
						repository: { id: repository.id, name: repository.name },
						projectId: options.project.id,
						externalId: String(target.number),
						title: `${repository.name} change ${target.number}`,
						draft: target.number === 2,
						state: merged ? "merged" : "open",
						createdAt: now - 86400,
						updatedAt: now - 1,
						observedAt: options.now,
						checksObservedAt: options.now,
						mergedAt: merged ? options.now - 1 : null,
						headSha: "head",
						targetSha: "target",
						coverage: "complete",
					},
				],
			};
		},
	});
}

test("Web and CLI share persisted watches; discovery is explicit and terminal refresh retires atomically", async ({
	page,
}) => {
	await page.clock.install();
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	expect(collectorQuerySchema.parse(await cli("status")).watching).toBe(0);
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Pull requests", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: "Watched PR refresh cooldown" }),
	).toHaveText("5 min");
	await cli("repo", "add", ...repos.map(repoUrl));
	expect((await watchList()).data).toEqual([]);
	await api.schedule("details");
	expect(await execute()).toEqual({ processed: false, state: "idle" });
	expect(providerRequests).toBe(0);
	for (const repo of repos) {
		await cli("discover", "--repo", repoUrl(repo));
		expect((await execute()).state).toBe("complete");
	}
	const all = pullListSchema.parse(
		await cli("pr", "list", "--state", "all", "--draft", "include", "--all"),
	);
	expect(all.data).toHaveLength(52);
	expect(all.data.some((pr) => pr.state === "draft")).toBe(true);
	expect(all.data.some((pr) => pr.state === "merged")).toBe(true);
	expect(all.data.some((pr) => pr.state === "closed")).toBe(true);
	expect((await watchList()).data).toEqual([]);
	const before = providerRequests;
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(20);
	const selectAll = page.getByRole("checkbox", {
		name: "Select all eligible PRs on this page",
	});
	await selectAll.check();
	await expect(page.getByText("20 selected", { exact: true })).toBeVisible();
	expect((await watchList()).data).toEqual([]);
	expect(providerRequests).toBe(before);
	await selectAll.uncheck();
	// A new page may fail before it has any cached data; returning to page 1 must still work.
	await page.route("**/api/query/v1/prs?**", (route) =>
		new URL(route.request().url()).searchParams.get("page") === "2"
			? route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({
						error: {
							code: "SERVICE_UNAVAILABLE",
							message: "PR page unavailable",
							retryable: true,
						},
					}),
				})
			: route.continue(),
	);
	await page.getByRole("button", { name: "Next page", exact: true }).click();
	await expect(page.getByText("Unable to load pull requests")).toBeVisible();
	await page
		.getByRole("button", { name: "Previous page", exact: true })
		.click();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(20);
	await page.unroute("**/api/query/v1/prs?**");
	const rows = page.locator("tr[data-pull-id]");
	const ids = [
		await rows.nth(0).getAttribute("data-pull-id"),
		await rows.nth(1).getAttribute("data-pull-id"),
	];
	const toggle = rows.nth(0).getByRole("button", { name: /^Watch PR/ });
	await rows.nth(1).getByRole("checkbox").check();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
	expect((await watchList()).data.map((watch) => watch.pullId)).toEqual([
		ids[0],
	]);
	const collection = page.getByRole("region", { name: "Collection progress" });
	await expect(collection).toBeVisible();
	expect(
		await collection.evaluate(
			(element) =>
				Boolean(element.closest("aside")) &&
				getComputedStyle(element).position !== "fixed",
		),
	).toBe(true);
	await page.screenshot({
		path: test.info().outputPath("watch-controls.png"),
		fullPage: true,
	});
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await toggle.press("Space");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	expect((await watchList()).data).toEqual([]);
	await rows.nth(1).getByRole("checkbox").uncheck();
	await rows.nth(0).getByRole("checkbox").check();
	await rows.nth(1).getByRole("checkbox").check();
	await page
		.getByRole("button", { name: "Add to watch list", exact: true })
		.click();
	await expect(
		page.getByText("2 PRs added to the shared watch list.", { exact: true }),
	).toBeVisible();
	expect((await watchList()).data.map((w) => w.pullId).sort()).toEqual(
		ids.sort(),
	);
	const draftUrl = `${repoUrl(repos[1]!)}/pullrequest/2`;
	await cli("watch", "add", draftUrl);
	const watched = await watchList();
	expect(watched.data).toHaveLength(3);
	expect(watched.data.find((w) => w.ref.number === 2)?.ref).toMatchObject({
		provider: "ado",
		organization: "e2e-two",
		projectKey: "Équipe",
		repository: { id: "repository-two", name: "Éditeur" },
	});
	await page.reload();
	await page.getByRole("combobox", { name: "Watch list filter" }).click();
	await page.getByRole("option", { name: /^Watching/ }).click();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(2);
	await page.getByRole("combobox", { name: "Draft", exact: true }).click();
	await page
		.getByRole("option", { name: "Include drafts", exact: true })
		.click();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	// A stale browser selection cannot remove a newer watch created by another client.
	const staleId = await page
		.locator("tr[data-pull-id]")
		.first()
		.getAttribute("data-pull-id");
	const staleGeneration = (await watchList()).data.find(
		(watch) => watch.pullId === staleId,
	)!.generation;
	await page.locator("tr[data-pull-id]").first().getByRole("checkbox").check();
	await cli("watch", "remove", staleId!);
	await cli("watch", "add", staleId!);
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(page.getByText(/Watch generation changed/)).toBeVisible();
	expect(
		(await watchList()).data.find((w) => w.pullId === staleId)?.generation,
	).toBe(staleGeneration + 1);
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	// Failure of the PR query preserves its last good rows; other cache blocks keep working.
	await page.route("**/api/query/v1/prs?**", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({
				error: {
					code: "UNAVAILABLE",
					message: "Temporary PR cache failure",
					retryable: true,
				},
			}),
		}),
	);
	await page.clock.fastForward(16000);
	await expect(page.getByText(/Temporary PR cache failure/)).toBeVisible();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	await page.unroute("**/api/query/v1/prs?**");
	await page.clock.fastForward(30000);
	await expect(page.getByText(/Temporary PR cache failure/)).toHaveCount(0);
	const beforeSourceSwitch = providerRequests;
	await page.getByRole("radio", { name: "Sample", exact: true }).click();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(0);
	expect((await watchList()).data).toHaveLength(3);
	expect(
		observationListSchema.parse(
			await cli("--source", "sample", "watch", "list"),
		).data,
	).toEqual([]);
	await page.getByRole("radio", { name: "Live", exact: true }).click();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	expect(providerRequests).toBe(beforeSourceSwitch);
	await execute();
	await execute();
	await execute();
	// Project edits resolve Unicode names to stable IDs without retiring valid watches.
	const unicodeProject = repoListSchema
		.parse(await cli("repo", "list"))
		.projects.find((project) => project.organization === repos[1]!.org)!;
	let projectRevision = unicodeProject.revision;
	const patchUnicodeProject = async (changes: Record<string, unknown>) => {
		const response = await page.request.patch(
			`${base}/api/projects/${unicodeProject.id}`,
			{ data: { revision: projectRevision, ...changes } },
		);
		expect(response.status(), await response.text()).toBe(200);
		projectRevision = projectSchema.parse(await response.json()).revision;
	};
	const watchesBeforeEdit = (await watchList()).data;
	for (const changes of [
		{ repositories: ["éditeur"] },
		{ description: "Updated without changing the monitored scope" },
		{ projectKey: "équipe" },
	]) {
		await patchUnicodeProject(changes);
		expect(
			(await watchList()).data.map(({ id, generation, active, pullId }) => ({
				id,
				generation,
				active,
				pullId,
			})),
		).toEqual(
			watchesBeforeEdit.map(({ id, generation, active, pullId }) => ({
				id,
				generation,
				active,
				pullId,
			})),
		);
		expect(
			pullListSchema.parse(
				await cli(
					"pr",
					"list",
					"--state",
					"all",
					"--draft",
					"include",
					"--all",
				),
			).data,
		).toHaveLength(52);
	}
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
	await page.screenshot({
		path: path.join(root, "test-results/monitoring-watch-list.png"),
		fullPage: true,
	});
	await selectAll.check();
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(
		page.getByText("3 PRs removed from the shared watch list.", {
			exact: true,
		}),
	).toBeVisible();
	expect((await watchList()).data).toEqual([]);
	await cli("watch", "add", draftUrl);
	expect((await execute(true)).state).toBe("complete");
	expect((await watchList()).data).toEqual([]);
	const final = pullListSchema.parse(
		await cli(
			"pr",
			"list",
			"--repo",
			repoUrl(repos[1]!),
			"--state",
			"merged",
			"--draft",
			"include",
			"--all",
		),
	);
	expect(final.data.find((p) => p.number === 2)?.observation).toMatchObject({
		active: false,
		stopReason: "completed",
	});
	expect((await execute()).state).toBe("idle");
	expect(repoListSchema.parse(await cli("repo", "list")).data).toHaveLength(2);
	// Provider renames keep old URLs usable and cannot create a second watch identity.
	const previousRepoUrl = repoUrl(repos[1]!);
	const retainedUrl = `${previousRepoUrl}/pullrequest/5`;
	await cli("watch", "add", retainedUrl);
	expect((await execute()).state).toBe("complete");
	const retainedWatch = (await watchList()).data[0]!;
	repos[1]!.name = "Éditeur-renamed";
	await cli("discover", "--repo", previousRepoUrl);
	expect((await execute()).state).toBe("complete");
	const catalogAfterRename = repoListSchema.parse(await cli("repo", "list"));
	expect(catalogAfterRename.page.total).toBe(2);
	expect(catalogAfterRename.coverage.state).toBe("complete");
	await cli("refresh", "--pr", retainedUrl);
	expect((await execute()).state).toBe("complete");
	const catalogAfterRefresh = repoListSchema.parse(await cli("repo", "list"));
	expect(
		catalogAfterRefresh.data.find((repo) => repo.repository.id === repos[1]!.id)
			?.repository.name,
	).toBe("Éditeur-renamed");
	expect(catalogAfterRefresh.page.total).toBe(2);
	expect(catalogAfterRefresh.coverage.state).toBe("complete");
	expect((await watchList()).data[0]).toMatchObject({
		id: retainedWatch.id,
		generation: retainedWatch.generation,
		active: true,
	});
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	await expect(
		page.getByText("Éditeur-renamed change 5", { exact: true }),
	).toBeVisible();
	const renamedPull = pullDetailSchema.parse(await cli("pr", "get", draftUrl));
	expect(renamedPull.data.repository).toMatchObject({
		id: "repository-two",
		name: "Éditeur-renamed",
	});
	const renamedUrl = `${repoUrl(repos[1]!)}/pullrequest/2`;
	await cli("watch", "add", draftUrl, renamedUrl, renamedPull.data.id);
	const renamedWatch = (await watchList()).data;
	expect(renamedWatch).toHaveLength(2);
	expect(renamedWatch[0]!.ref.repository).toEqual({
		id: "repository-two",
		name: "Éditeur-renamed",
		projectExternalId: "project-guid-two",
	});
	await patchUnicodeProject({
		description: "Metadata edit after provider rename",
	});
	expect((await watchList()).data[0]).toMatchObject({
		id: renamedWatch[0]!.id,
		generation: renamedWatch[0]!.generation,
		active: true,
		pullId: renamedPull.data.id,
	});
	await cli("watch", "remove", renamedUrl, retainedUrl);
	expect((await watchList()).data).toEqual([]);
	// Real collector + HTTP staging validates observation time across slow authentication and summary reads.
	const slowUrl = `${repoUrl(repos[0]!)}/pullrequest/26`;
	await cli("watch", "add", slowUrl);
	const realNow = Date.now;
	const startedAt = Math.floor(realNow() / 1000);
	let clock = startedAt * 1000;
	let auths = 0;
	Date.now = () => clock;
	try {
		const provider: AdoPagedClient = {
			checkAuth: async () => {
				clock += auths++ === 0 ? 60000 : 10000;
			},
			invalidateToken: () => {},
			post: async () => ({ value: [] }),
			getPage: async () => ({ data: { value: [] }, continuationToken: null }),
			get: async (url) => {
				if (!url.includes("/pullrequests/26?")) return { value: [] };
				clock += 10000;
				return {
					pullRequestId: 26,
					status: "completed",
					title: "Merged during authentication",
					sourceRefName: "refs/heads/feature",
					targetRefName: "refs/heads/main",
					creationDate: new Date((startedAt - 100) * 1000).toISOString(),
					closedDate: new Date((startedAt + 75) * 1000).toISOString(),
					repository: {
						id: repos[0]!.id,
						name: repos[0]!.name,
						project: { id: repos[0]!.projectGuid, name: repos[0]!.project },
					},
				};
			},
		};
		expect(
			(await runCollectionOnce({ api, makeAdo: () => provider, log: silent }))
				.state,
		).toBe("complete");
	} finally {
		Date.now = realNow;
	}
	const slowResult = await cli("pr", "get", slowUrl);
	expect(slowResult.data.state).toBe("merged");
	expect(slowResult.data.freshness.listObservedAt).toBe(
		new Date((startedAt + 80) * 1000).toISOString(),
	);
	expect(slowResult.data.observation).toMatchObject({
		active: false,
		stopReason: "completed",
	});
	// Reusing stable PR IDs after an external project edit must not attach its old stopped watch.
	const oldProjectUrl = `${repoUrl(repos[0]!)}/pullrequest/1`;
	await cli("watch", "add", oldProjectUrl);
	const projectBeforeMove = repoListSchema
		.parse(await cli("repo", "list"))
		.projects.find((project) => project.organization === repos[0]!.org)!;
	const moved = await page.request.patch(
		`${base}/api/projects/${projectBeforeMove.id}`,
		{
			data: { revision: projectBeforeMove.revision, projectKey: "Zulu" },
		},
	);
	expect(moved.status(), await moved.text()).toBe(200);
	repos[0]!.project = "Zulu";
	expect((await watchList()).data).toEqual([]);
	await cli("discover", "--repo", repoUrl(repos[0]!));
	expect((await execute()).state).toBe("complete");
	const currentProjectUrl = `${repoUrl(repos[0]!)}/pullrequest/1`;
	expect(
		pullDetailSchema.parse(await cli("pr", "get", currentProjectUrl)).data
			.observation,
	).toBeNull();
	await cli("watch", "add", currentProjectUrl);
	const currentWatch = (await watchList()).data[0]!;
	expect(
		pullDetailSchema.parse(await cli("pr", "get", currentProjectUrl)).data
			.observation,
	).toMatchObject({
		id: currentWatch.id,
		active: true,
		ref: { projectKey: "Zulu" },
	});
	await page.reload();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	await selectAll.check();
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(
		page.getByText("1 PR removed from the shared watch list.", { exact: true }),
	).toBeVisible();
	expect((await watchList()).data).toEqual([]);

	// Uncached CLI watches have independent pagination and errors in the browser.
	const pendingUrls = Array.from(
		{ length: 21 },
		(_, i) => `${repoUrl(repos[0]!)}/pullrequest/${1000 + i}`,
	);
	await cli("watch", "add", ...pendingUrls);
	await page.route("**/api/query/v1/observations?**", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({
				error: {
					code: "SERVICE_UNAVAILABLE",
					message: "Pending watches unavailable",
					retryable: true,
				},
			}),
		}),
	);
	await page.goto("/?watching=watching");
	const pending = page.getByRole("region", { name: "Pending watches" });
	await expect(pending.getByText(/Pending watches unavailable/)).toBeVisible();
	await page.unroute("**/api/query/v1/observations?**");
	await pending.getByRole("button", { name: "Retry pending watches" }).click();
	await expect(pending.getByRole("link")).toHaveCount(20);
	await page.route("**/api/query/v1/observations?**", (route) =>
		new URL(route.request().url()).searchParams.get("page") === "2"
			? route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({
						error: {
							code: "SERVICE_UNAVAILABLE",
							message: "Pending page unavailable",
							retryable: true,
						},
					}),
				})
			: route.continue(),
	);
	await pending.getByRole("button", { name: "Next pending page" }).click();
	await expect(pending.getByText("Pending page unavailable")).toBeVisible();
	await pending.getByRole("button", { name: "Previous pending page" }).click();
	await expect(pending.getByRole("link")).toHaveCount(20);
	await page.unroute("**/api/query/v1/observations?**");
	await pending.getByRole("button", { name: "Next pending page" }).click();
	await expect(pending.getByRole("link")).toHaveCount(1);
	await expect(pending.getByRole("link")).toHaveText(/#1020/);
	await pending.getByRole("button", { name: "Remove", exact: true }).click();
	await expect(pending.getByRole("link")).toHaveCount(20);
	expect((await watchList()).data).toHaveLength(20);
	await cli("watch", "remove", ...pendingUrls.slice(0, 20));
	await page.reload();
	await expect(pending).toHaveCount(0);

	// A first-load detail error must not pretend the cached PR was removed.
	const detailPull = pullDetailSchema.parse(
		await cli("pr", "get", all.data.find((pr) => pr.state === "open")!.id),
	).data;
	await page.route("**/api/query/v1/prs/*?**", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({
				error: {
					code: "SERVICE_UNAVAILABLE",
					message: "Detail cache unavailable",
					retryable: true,
				},
			}),
		}),
	);
	await page.goto(`/?pr=${encodeURIComponent(detailPull.id)}`);
	await expect(
		page.getByRole("heading", { name: "Unable to load PR details" }),
	).toBeVisible();
	await expect(page.getByText("PR not found", { exact: true })).toHaveCount(0);
	await page.unroute("**/api/query/v1/prs/*?**");
	await page.getByRole("button", { name: "Retry PR details" }).click();
	await expect(
		page.getByRole("heading", { name: detailPull.title, exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Close pull request details" })
		.click();

	// Built assets use the local server's Sample command capability, independent of Vite DEV.
	await page.getByRole("radio", { name: "Sample", exact: true }).click();
	const discoverSample = page.getByRole("button", {
		name: "Discover PRs",
		exact: true,
	});
	await expect(discoverSample).toBeEnabled();
	await discoverSample.click();
	await expect(page.getByText(/Queued discovery for 1 project/)).toBeVisible();
	const providerBeforeSample = providerRequests;
	expect((await execute()).state).toBe("complete");
	expect(providerRequests).toBe(providerBeforeSample);
	expect(
		pullListSchema.parse(
			await cli(
				"--source",
				"sample",
				"pr",
				"list",
				"--draft",
				"include",
				"--all",
			),
		).data,
	).toHaveLength(6);
	expect(
		observationListSchema.parse(
			await cli("--source", "sample", "watch", "list"),
		).data,
	).toEqual([]);
	expect((await watchList()).data).toEqual([]);
	expect(browserErrors).toEqual([]);
});

test("repository IDs remain scoped across cold discovery, mixed watch batches, CLI and browser filters", async ({
	page,
}) => {
	const id = "11111111-1111-1111-1111-111111111111";
	const otherId = "22222222-2222-2222-2222-222222222222";
	const organization = "e2e-identity";
	const repositoryUrl = `https://dev.azure.com/${organization}/Identity/_git/${id}`;
	const repositories = [
		{ id: otherId, name: id },
		{ id, name: "main-repository" },
	];
	let requests = 0;
	const provider: AdoPagedClient = {
		...fakeAdo,
		checkAuth: async () => {
			requests++;
		},
		getPage: async (value) => {
			requests++;
			const url = new URL(value);
			const externalProject = { id: "identity-project-guid", name: "Identity" };
			if (url.pathname.endsWith("/repositories"))
				return {
					data: {
						value: repositories.map((item) => ({
							...item,
							project: externalProject,
						})),
					},
					continuationToken: null,
				};
			if (url.pathname.endsWith("/configurations"))
				return { data: { value: [] }, continuationToken: null };
			const repo = repositories.find((r) => url.pathname.includes(`/${r.id}/`));
			expect(repo).toBeDefined();
			expect(url.searchParams.get("searchCriteria.status")).toBe("all");
			return {
				data: {
					value: [1, 2].map((number) => ({
						pullRequestId: number,
						title: `${repo!.name} change ${number}`,
						status: "active",
						isDraft: number === 2,
						creationDate: new Date((now - 86400) * 1000).toISOString(),
						createdBy: { id: "identity-author", displayName: "Grace Hopper" },
						sourceRefName: "refs/heads/feature",
						targetRefName: "refs/heads/main",
						repository: { ...repo, project: externalProject },
					})),
				},
				continuationToken: null,
			};
		},
	};
	const executeDiscovery = async (receipt: unknown) => {
		const { jobs } = commandReceiptSchema.parse(receipt);
		expect(
			(
				await runCollectionOnce({
					api,
					makeAdo: () => provider,
					log: silent,
					jobId: jobs[0]!.id,
				})
			).state,
		).toBe("complete");
	};
	await cli("repo", "add", repositoryUrl);
	await page.goto(
		`/?${new URLSearchParams({ source: "cli", org: organization, draft: "include" })}`,
	);
	const repoSelector = page.getByRole("combobox", {
		name: "Repository",
		exact: true,
	});
	await repoSelector.click();
	await page.getByRole("option", { name: id, exact: false }).click();
	await expect(repoSelector).toContainText(id);
	const discoveryResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/commands/v1/discover") &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Discover PRs", exact: true }).click();
	await executeDiscovery(await (await discoveryResponse).json());
	await page.reload();
	await expect(repoSelector).toHaveText("main-repository");
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(2);
	await expect
		.poll(() => new URL(page.url()).searchParams.get("repo"))
		.toBe(id);
	const initial = repoListSchema.parse(await cli("repo", "list", "--all"));
	const project = initial.projects.find(
		(p) => p.organization === organization,
	)!;
	expect(
		initial.data
			.filter((r) => r.project.id === project.id)
			.map((r) => r.repository.id),
	).toEqual([id]);
	const expand = await page.request.patch(
		`${base}/api/projects/${project.id}`,
		{
			data: { revision: project.revision, repositories: [] },
		},
	);
	expect(expand.status()).toBe(200);
	const expanded = projectSchema.parse(await expand.json());
	const discovered = await page.request.post(
		`${base}/api/commands/v1/discover`,
		{ data: { projectId: project.id } },
	);
	expect(discovered.status()).toBe(202);
	await executeDiscovery(await discovered.json());
	const selected = pullListSchema.parse(
		await cli(
			"pr",
			"list",
			"--repo",
			repositoryUrl,
			"--draft",
			"include",
			"--all",
		),
	);
	expect(selected.data).toHaveLength(2);
	expect(selected.data.every((pull) => pull.repository.id === id)).toBe(true);
	const beforeQueries = requests;
	const batch = await page.request.post(
		`${base}/api/commands/v1/observations`,
		{
			data: {
				refs: [
					{ pullId: selected.data[0]!.id },
					{
						url: `https://dev.azure.com/${organization}/Identity/_git/%ZZ/pullrequest/3`,
					},
					{ pullId: selected.data[1]!.id },
				],
			},
		},
	);
	expect(batch.status()).toBe(200);
	const added = batchCommandSchema.parse(await batch.json());
	expect(added.results.map((r) => r.status)).toEqual([
		"added",
		"rejected",
		"added",
	]);
	expect(added.results[1]?.error?.code).toBe("INVALID_REFERENCE");
	for (const item of [added.results[0]!, added.results[2]!])
		expect((await cli("job", "get", item.job!.id)).state).toBe("queued");
	await cli(
		"watch",
		"add",
		`${repositoryUrl.replace(id, otherId)}/pullrequest/2`,
	);
	expect(
		observationListSchema.parse(
			await cli("watch", "list", "--repo", repositoryUrl),
		).data,
	).toHaveLength(2);
	await page.goto(
		`/?${new URLSearchParams({ source: "cli", org: organization, project: project.id, repo: id, watching: "watching", draft: "include" })}`,
	);
	const rows = page.locator("tr[data-pull-id]");
	await expect(rows).toHaveCount(2);
	await expect(
		page.getByRole("combobox", { name: "Repository", exact: true }),
	).toHaveText("main-repository");
	expect(
		(
			await rows.evaluateAll((elements) =>
				elements.map((element) => element.getAttribute("data-pull-id")),
			)
		).sort(),
	).toEqual(selected.data.map((pull) => pull.id).sort());
	await cli("watch", "remove", `${repositoryUrl}/pullrequest/1`);
	await page.reload();
	await expect(rows).toHaveCount(1);
	const narrow = await page.request.patch(
		`${base}/api/projects/${project.id}`,
		{
			data: { revision: expanded.revision, repositories: [id] },
		},
	);
	expect(narrow.status()).toBe(200);
	const remaining = observationListSchema.parse(
		await cli("watch", "list", "--org", organization),
	);
	expect(remaining.data.map((watch) => watch.ref.repository.id)).toEqual([id]);
	await page.reload();
	await expect(rows).toHaveCount(1);
	await rows.getByRole("checkbox").check();
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(
		page.getByText("1 PR removed from the shared watch list.", { exact: true }),
	).toBeVisible();
	expect(
		observationListSchema.parse(
			await cli("watch", "list", "--org", organization),
		).data,
	).toEqual([]);
	expect(requests).toBe(beforeQueries);
});
