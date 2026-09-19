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
	machinePageSchema,
	machinePreviewSchema,
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
async function execute(merged = false, jobId?: string) {
	return runCollectionOnce({
		api,
		jobId,
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
						observedAt: Math.floor(options.now),
						summaryObservedAt: options.now,
						checksObservedAt: Math.floor(options.now),
						mergedAt: merged ? Math.floor(options.now) - 1 : null,
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
	// The full lifecycle runs many real CLI subprocesses alongside browser I/O.
	test.slow();
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
	let releaseList!: () => void;
	const listGate = new Promise<void>((resolve) => {
		releaseList = resolve;
	});
	await page.route("**/api/query/v1/prs?**", async (route) => {
		await listGate;
		await route.continue();
	});
	await page.reload({ waitUntil: "domcontentloaded" });
	const loadingTable = page.getByRole("table", { name: "Pull requests" });
	await expect(loadingTable).toHaveAttribute("aria-busy", "true");
	await expect(
		loadingTable.getByRole("columnheader", { name: "Target branch" }),
	).toBeVisible();
	await expect(loadingTable.getByRole("checkbox")).toBeDisabled();
	const skeletonTable = await loadingTable.elementHandle();
	await page.screenshot({
		path: test.info().outputPath("pull-loading.png"),
		fullPage: true,
	});
	releaseList();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(20);
	await expect(loadingTable).toHaveAttribute("aria-busy", "false");
	expect(await skeletonTable!.evaluate((element) => element.isConnected)).toBe(
		true,
	);
	await page.unroute("**/api/query/v1/prs?**");
	const filters = page.getByRole("region", { name: "PR filters", exact: true });
	const results = page.getByRole("region", { name: "PR results", exact: true });
	await expect(
		filters.getByRole("combobox", { name: "Organization" }),
	).toBeVisible();
	await expect(
		filters.getByRole("textbox", { name: "Search PRs" }),
	).toBeVisible();
	await expect(
		results.getByRole("table", { name: "Pull requests" }),
	).toBeVisible();
	expect(
		(await filters.boundingBox())!.y + (await filters.boundingBox())!.height,
	).toBeLessThan((await results.boundingBox())!.y);
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
	const targetBranch = rows
		.nth(0)
		.getByRole("link", { name: /^Open target branch main/ });
	await expect(targetBranch).toHaveAttribute(
		"href",
		/\/_git\/repository-(one|two)\?version=GBmain$/,
	);
	await expect(targetBranch).toHaveAttribute("target", "_blank");
	const rowBox = (await rows.nth(0).boundingBox())!;
	for (const control of [rows.nth(0).getByRole("checkbox"), toggle]) {
		const box = (await control.boundingBox())!;
		expect(
			Math.abs(box.y + box.height / 2 - (rowBox.y + rowBox.height / 2)),
		).toBeLessThan(1.5);
	}
	const originalViewport = page.viewportSize()!;
	const titleColumn = page.getByRole("columnheader", {
		name: "Sort by Pull request",
	});
	const checksColumn = page.getByRole("columnheader", {
		name: "Sort by Checks & stages",
	});
	const actionColumn = page.getByRole("columnheader", {
		name: "Sort by Next action",
	});
	for (const width of [1920, 2560]) {
		await page.setViewportSize({ width, height: 1080 });
		const titleWidth = (await titleColumn.boundingBox())!.width;
		expect(titleWidth).toBeGreaterThanOrEqual(239);
		expect(titleWidth).toBeLessThanOrEqual(401);
		expect(
			Math.abs(
				(await checksColumn.boundingBox())!.width -
					(await actionColumn.boundingBox())!.width,
			),
		).toBeLessThan(2);
		await page.screenshot({
			path: test.info().outputPath(`pull-wide-layout-${width}.png`),
			fullPage: true,
		});
	}
	await page.setViewportSize(originalViewport);
	await rows.nth(1).getByRole("checkbox").check();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	const table = page.getByRole("table", { name: "Pull requests" });
	const tableTop = (await table.boundingBox())!.y;
	const originalTable = await table.elementHandle();
	let releaseWatch!: () => void;
	const watchGate = new Promise<void>((resolve) => {
		releaseWatch = resolve;
	});
	await page.route("**/api/commands/v1/observations", async (route) => {
		await watchGate;
		await route.continue();
	});
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(toggle).toHaveAttribute("aria-busy", "true");
	await expect(
		rows.nth(1).getByRole("button", { name: /^Watch PR/ }),
	).toBeEnabled();
	expect((await watchList()).data).toEqual([]);
	expect(await originalTable!.evaluate((element) => element.isConnected)).toBe(
		true,
	);
	expect((await table.boundingBox())!.y).toBe(tableTop);
	releaseWatch();
	await expect(toggle).toHaveAttribute("aria-busy", "false");
	await page.unroute("**/api/commands/v1/observations");
	expect((await table.boundingBox())!.y).toBe(tableTop);
	await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
	expect((await watchList()).data.map((watch) => watch.pullId)).toEqual([
		ids[0],
	]);
	const collection = page.getByRole("region", { name: "Connector status" });
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
	await expect(toggle).toHaveAttribute("aria-busy", "false");
	expect((await watchList()).data).toEqual([]);
	let rejectWatch!: () => void;
	const rejectionGate = new Promise<void>((resolve) => {
		rejectWatch = resolve;
	});
	await page.route("**/api/commands/v1/observations", async (route) => {
		await rejectionGate;
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				results: [
					{
						status: "rejected",
						error: {
							code: "PR_TERMINAL",
							message: "This PR was just merged",
							retryable: false,
						},
					},
				],
			}),
		});
	});
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	rejectWatch();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("status", { name: "Watch list updates" }),
	).toContainText("This PR was just merged");
	expect((await table.boundingBox())!.y).toBe(tableTop);
	expect((await watchList()).data).toEqual([]);
	await page.unroute("**/api/commands/v1/observations");
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
	await page.getByRole("button", { name: "Watched", exact: true }).click();
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
	// A CLI mutation and a status-only publication must reconcile this mounted
	// page and its detail sheet without reloads or a Web provider command.
	await page.clock.fastForward(3100);
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	await page
		.getByRole("button", { name: "Open PR #2: Éditeur change 2", exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	const watchedDraft = (await watchList()).data[0]!;
	// Keep its full checks lease running: lifecycle work must bypass it.
	const blockedChecks = (await api.claim())!;
	expect(blockedChecks.observation?.id).toBe(watchedDraft.id);
	await api.schedule("details", "status");
	const stateReads: string[] = [];
	const terminalProvider: AdoPagedClient = {
		...fakeAdo,
		get: async (url) => {
			stateReads.push(url);
			expect(url).toContain("/pullrequests/2?");
			return {
				pullRequestId: 2,
				title: "Éditeur change 2",
				status: "completed",
				isDraft: true,
				creationDate: new Date((now - 86400) * 1000).toISOString(),
				closedDate: new Date().toISOString(),
				createdBy: { id: "author-one", displayName: "Ada Lovelace" },
				sourceRefName: "refs/heads/feature",
				repository: { id: repos[1]!.id, name: repos[1]!.name },
				lastMergeSourceCommit: { commitId: "head" },
				lastMergeTargetCommit: { commitId: "target" },
				targetRefName: "refs/heads/main",
			};
		},
		getPage: async () => {
			throw new Error(
				"A terminal status must not wait for checks or inventory",
			);
		},
	};
	const statusErrors: string[] = [];
	const terminalResult = await runCollectionOnce({
		api,
		makeAdo: () => terminalProvider,
		log: { ...silent, error: (message) => statusErrors.push(message) },
		lane: "status",
	});
	expect(terminalResult.state, statusErrors.join("\n")).toBe("complete");
	expect(stateReads).toHaveLength(1);
	expect((await api.job(blockedChecks.job.id)).state).toBe("canceled");
	await page.clock.fastForward(3100);
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toContainText("Merged");
	await page.keyboard.press("Escape");
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
		new Date((startedAt + 70) * 1000).toISOString(),
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

test("state machines preview, save and restore scoped rules without changing facts or watches", async ({
	page,
}) => {
	const repo = {
		org: "e2e-machines",
		project: "Machines",
		id: "machine-repository",
		name: "machines",
		projectGuid: "machine-project",
	};
	repos.push(repo);
	await cli("repo", "add", repoUrl(repo));
	const discovery = commandReceiptSchema.parse(
		await cli("discover", "--repo", repoUrl(repo)),
	);
	expect((await execute(false, discovery.jobs[0]!.id)).state).toBe("complete");
	const watch = batchCommandSchema.parse(
		await cli("watch", "add", `${repoUrl(repo)}/pullrequest/1`),
	);
	expect((await execute(false, watch.results[0]!.job!.id)).state).toBe(
		"complete",
	);
	const before = pullDetailSchema.parse(
		await cli("pr", "get", `${repoUrl(repo)}/pullrequest/1`),
	);
	const pull = before.data;
	const projectId = pull.project.id;
	const machineUrl = `${base}/api/state-machines/${projectId}?source=live&repositoryId=${repo.id}&pullId=${encodeURIComponent(pull.id)}`;
	const initial = machinePageSchema.parse(
		await (await page.request.get(machineUrl)).json(),
	);
	const readsBefore = providerRequests;
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		`/state-machines?${new URLSearchParams({ source: "cli", project: projectId, repo: repo.id, trace: pull.id, tab: "priority" })}`,
	);
	await expect(
		page.getByRole("heading", { name: "State machines", exact: true }),
	).toBeVisible();
	await expect(
		page.locator('.react-flow__node[data-id="state:blocked"]'),
	).toBeVisible();
	await expect(
		page.getByRole("tab", { name: "Priority", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	const canvas = page.getByRole("region", { name: "State machine graph" });
	const expandedCanvas = (await canvas.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(expandedCanvas.y).toBeLessThan(180);
	expect(expandedCanvas.height).toBeGreaterThan(viewport.height * 0.7);
	expect(expandedCanvas.y + expandedCanvas.height).toBeLessThanOrEqual(
		viewport.height,
	);
	await page
		.getByRole("button", { name: "Hide inspector", exact: true })
		.click();
	await expect(page.getByRole("tabpanel")).toHaveCount(0);
	expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(
		expandedCanvas.width,
	);
	const watchedFilter = page.getByRole("button", {
		name: "Watched",
		exact: true,
	});
	const picker = page.getByRole("combobox", {
		name: "Trace pull request",
		exact: true,
	});
	await expect(watchedFilter).toHaveAttribute("aria-pressed", "true");
	await picker.click();
	await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await watchedFilter.click();
	await picker.click();
	const choices = page.getByRole("listbox");
	await expect(choices.getByRole("option")).toHaveCount(20);
	expect((await choices.boundingBox())!.height).toBeLessThanOrEqual(336);
	await choices.locator("[data-radix-select-viewport]").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(choices.getByRole("option")).toHaveCount(26);
	await choices
		.getByRole("option", { name: /^#1\s+machines change 1$/ })
		.click();
	await page
		.getByRole("textbox", { name: "Search cached PRs", exact: true })
		.fill("#5");
	await picker.click();
	await expect(choices.getByRole("option")).toHaveCount(3);
	await choices
		.getByRole("option", { name: /^#5\s+machines change 5$/ })
		.click();
	await expect(page).toHaveURL(/trace=[^&]*%3A5(?:&|$)/);
	await page
		.getByRole("textbox", { name: "Search cached PRs", exact: true })
		.fill("");
	await watchedFilter.click();
	await picker.click();
	await expect(choices.getByRole("option")).toHaveCount(1);
	await choices
		.getByRole("option", { name: /^#1\s+machines change 1$/ })
		.click();
	await expect(page).toHaveURL(/trace=[^&]*%3A1(?:&|$)/);
	await page.getByRole("tab", { name: "States", exact: true }).click();
	const label = page.getByLabel(`${pull.readiness.stateId} display name`, {
		exact: true,
	});
	await label.locator("xpath=ancestor::details").locator("summary").click();
	await label.fill("Needs action");
	await page
		.getByRole("button", { name: "Hide inspector", exact: true })
		.click();
	await page.getByRole("tab", { name: "States", exact: true }).click();
	await label.locator("xpath=ancestor::details").locator("summary").click();
	await expect(label).toHaveValue("Needs action");
	await expect(
		page.getByRole("button", { name: "Save rules", exact: true }),
	).toBeDisabled();
	const previewResponse = page.waitForResponse(
		(response) =>
			response.url().includes("/preview?") &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: "Preview changes", exact: true })
		.click();
	const preview = machinePreviewSchema.parse(
		await (await previewResponse).json(),
	);
	expect(
		preview.changes.some(
			(change) =>
				change.id === pull.id && change.after.label === "Needs action",
		),
	).toBe(true);
	await expect(
		page.getByRole("button", { name: "Save rules", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Save rules", exact: true }).click();
	await expect(page.getByText(/Saved revision 2\./)).toBeVisible();
	const saved = pullDetailSchema.parse(await cli("pr", "get", pull.id));
	expect(saved.data.readiness.label).toBe("Needs action");
	expect(saved.data.policies).toEqual(pull.policies);
	expect(saved.data.builds).toEqual(pull.builds);
	expect(saved.data.checksObservedAt).toBe(pull.checksObservedAt);
	await page.getByRole("tab", { name: "History", exact: true }).click();
	await page
		.getByRole("button", { name: "Load revision 1 as draft", exact: true })
		.click();
	await expect(page.getByText(/Revision 1 loaded as a draft/)).toBeVisible();
	await page
		.getByRole("button", { name: "Preview changes", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Save rules", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Save rules", exact: true }).click();
	await expect(page.getByText(/Saved revision 3\./)).toBeVisible();
	const restored = machinePageSchema.parse(
		await (await page.request.get(machineUrl)).json(),
	);
	expect(restored.inherited).toBe(true);
	expect(restored.config).toEqual(initial.config);
	expect(
		pullDetailSchema.parse(await cli("pr", "get", pull.id)).data.readiness
			.label,
	).toBe(pull.readiness.label);
	// An otherwise matching mapping cannot turn missing checks into readiness.
	const unsafe = structuredClone(restored.config);
	unsafe.mappings.unshift({
		id: "unsafe",
		name: "Force ready",
		stateId: "ready",
		enabled: true,
		match: "all",
		conditions: [{ fact: "lifecycle", oneOf: ["open"] }],
	});
	const guarded = machinePreviewSchema.parse(
		await (
			await page.request.post(
				`${base}/api/state-machines/${projectId}/preview?source=live`,
				{ data: { revision: 3, repositoryId: repo.id, config: unsafe } },
			)
		).json(),
	);
	expect(
		guarded.evaluations.find((pr) => pr.number === 5)?.readiness.ready,
	).toBe(false);
	expect(
		guarded.evaluations.find((pr) => pr.number === 5)?.trace[0]?.guard,
	).toBeTruthy();
	expect(providerRequests).toBe(readsBefore);
	expect(
		(await watchList()).data.some((entry) => entry.pullId === pull.id),
	).toBe(true);
	await page
		.getByRole("button", { name: "Observed transitions", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Observed transitions", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("checkbox", { name: "All collected gates" }),
	).toBeDisabled();
	await page.screenshot({
		path: test.info().outputPath("state-machine-history.png"),
		fullPage: true,
	});
	await page.evaluate(() => localStorage.setItem("signoff-theme", "dark"));
	await page.reload();
	await expect(page.locator(".machine-canvas .react-flow")).toHaveClass(/dark/);
	await page
		.getByRole("button", { name: "Hide inspector", exact: true })
		.click();
	await page.setViewportSize({ width: 390, height: 844 });
	await picker.click();
	await expect(choices.getByRole("option")).toHaveCount(1);
	const mobileMenu = await choices.boundingBox();
	expect(mobileMenu!.width).toBeGreaterThanOrEqual(340);
	expect(mobileMenu!.height).toBeLessThanOrEqual(336);
	expect(mobileMenu!.y).toBeGreaterThanOrEqual(0);
	expect(mobileMenu!.y + mobileMenu!.height).toBeLessThanOrEqual(844);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(390);
	await page.screenshot({
		path: test.info().outputPath("state-machine-mobile.png"),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await page.getByRole("tab", { name: "Inspect", exact: true }).click();
	const mobileInspector = (await page.getByRole("tabpanel").boundingBox())!;
	expect(mobileInspector.x).toBeGreaterThanOrEqual(0);
	expect(mobileInspector.x + mobileInspector.width).toBeLessThanOrEqual(390);
	expect(mobileInspector.y + mobileInspector.height).toBeLessThanOrEqual(844);
	await page
		.getByRole("button", { name: "Hide inspector", exact: true })
		.focus();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tabpanel")).toHaveCount(0);
	await expect(
		page.getByRole("tab", { name: "Inspect", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(
		page.getByRole("tabpanel", { name: "Priority", exact: true }),
	).toBeVisible();
	await page.getByRole("tabpanel").getByRole("combobox").first().click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(page.getByRole("tabpanel")).toHaveCount(1);
	await page.getByRole("tab", { name: "Priority", exact: true }).focus();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tabpanel")).toHaveCount(0);
	expect(errors).toEqual([]);
	await cli("watch", "remove", pull.id);
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

test("incremental discovery retries from its last success and full discovery reconciles older cached PRs", async ({
	page,
}) => {
	const repository = { id: "incremental-repo", name: "incremental" };
	const externalProject = { id: "incremental-project", name: "Incremental" };
	const url =
		"https://dev.azure.com/e2e-incremental/Incremental/_git/incremental";
	let total = 250;
	let failSecondPage = false;
	let mergedFirst = false;
	let calls: URL[] = [];
	const provider: AdoPagedClient = {
		...fakeAdo,
		checkAuth: async () => {},
		getPage: async (value) => {
			const request = new URL(value);
			if (request.pathname.endsWith("/repositories"))
				return {
					data: { value: [{ ...repository, project: externalProject }] },
					continuationToken: null,
				};
			calls.push(request);
			expect(request.searchParams.get("searchCriteria.status")).toBe("all");
			expect(
				request.searchParams.get("searchCriteria.queryTimeRangeType"),
			).toBe("created");
			const skip = Number(request.searchParams.get("$skip"));
			if (failSecondPage && skip > 0)
				throw new Error("Injected missing history page");
			const since = request.searchParams.has("searchCriteria.minTime")
				? Date.parse(request.searchParams.get("searchCriteria.minTime")!)
				: 0;
			const until = Date.parse(
				request.searchParams.get("searchCriteria.maxTime")!,
			);
			const data = Array.from({ length: total }, (_, i) => {
				const number = total - i;
				return {
					pullRequestId: number,
					title: `Incremental PR ${number}`,
					status:
						number === 1 && mergedFirst
							? "completed"
							: number % 3 === 0
								? "completed"
								: number % 3 === 2
									? "abandoned"
									: "active",
					isDraft: number === 379,
					creationDate: new Date((now - 2000 + number) * 1000).toISOString(),
					closedDate: new Date((now - 60) * 1000).toISOString(),
					createdBy: { id: "incremental-author", displayName: "Author" },
					sourceRefName: "refs/heads/feature",
					targetRefName: "refs/heads/main",
					repository: { ...repository, project: externalProject },
				};
			}).filter(
				(pull) =>
					Date.parse(pull.creationDate) > since &&
					Date.parse(pull.creationDate) < until,
			);
			return {
				data: { value: data.slice(skip, skip + 100) },
				continuationToken: null,
			};
		},
	};
	const discover = async (full = false) => {
		const receipt = commandReceiptSchema.parse(
			await cli("discover", "--repo", url, ...(full ? ["--full"] : [])),
		);
		calls = [];
		return runCollectionOnce({
			api,
			makeAdo: () => provider,
			log: silent,
			jobId: receipt.jobs[0]!.id,
		});
	};
	const list = async () =>
		pullListSchema.parse(
			await cli(
				"pr",
				"list",
				"--repo",
				url,
				"--state",
				"all",
				"--draft",
				"include",
				"--all",
			),
		);
	await cli("repo", "add", url);
	expect((await discover()).state).toBe("complete");
	expect(calls).toHaveLength(3);
	expect(
		calls.every(
			(request) => !request.searchParams.has("searchCriteria.minTime"),
		),
	).toBe(true);
	expect((await list()).data).toHaveLength(250);
	total = 380;
	failSecondPage = true;
	expect((await discover()).state).toBe("failed");
	expect(calls).toHaveLength(2);
	expect((await list()).data).toHaveLength(250);
	const boundary = new Date((now - 2000 + 249) * 1000).toISOString();
	expect(calls[0]!.searchParams.get("searchCriteria.minTime")).toBe(boundary);
	failSecondPage = false;
	expect((await discover()).state).toBe("complete");
	expect(calls).toHaveLength(2);
	expect(calls[0]!.searchParams.get("searchCriteria.minTime")).toBe(boundary);
	const after = await list();
	expect(after.data).toHaveLength(380);
	expect(new Set(after.data.map((pull) => pull.id)).size).toBe(380);
	expect(after.data.find((pull) => pull.number === 379)?.state).toBe("draft");
	mergedFirst = true;
	expect((await discover()).state).toBe("complete");
	expect(calls).toHaveLength(1);
	expect((await list()).data.find((pull) => pull.number === 1)?.state).toBe(
		"open",
	);
	expect((await discover(true)).state).toBe("complete");
	expect(calls).toHaveLength(4);
	expect(
		calls.every(
			(request) => !request.searchParams.has("searchCriteria.minTime"),
		),
	).toBe(true);
	expect((await list()).data.find((pull) => pull.number === 1)?.state).toBe(
		"merged",
	);
	expect(
		observationListSchema.parse(await cli("watch", "list", "--repo", url)).data,
	).toEqual([]);
	await page.goto(
		`/?${new URLSearchParams({ source: "cli", org: "e2e-incremental", draft: "include", q: "Incremental PR 379" })}`,
	);
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Open PR #379: Incremental PR 379" }),
	).toBeVisible();
	await expect(
		page.locator("tr[data-pull-id]").getByRole("button", { name: /^Watch PR/ }),
	).toHaveAttribute("aria-pressed", "false");
});

test("sidebar connector keeps stable geometry through loading, activity and feedback in desktop and mobile navigation", async ({
	page,
}) => {
	await page.clock.install();
	const current = collectorQuerySchema.parse(await cli("status"));
	const updatedAt = new Date().toISOString();
	const status = {
		...current,
		detailCooldownSeconds: 300,
		scheduling: {
			strategy: "per_pr",
			checksConcurrency: 2,
			statusConcurrency: 2,
			nextCheckDueAt: new Date(Date.now() + 180000).toISOString(),
			overdueChecks: 0,
			oldestChecksAgeSeconds: 420,
			oldestSummaryAgeSeconds: 20,
			missingChecks: 1,
		},
		connection: { state: "ready", lastSeenAt: updatedAt, message: "Connected" },
		watching: 16,
		queue: { running: 1, queued: 3, authRequired: 0 },
		jobs: [
			{
				id: "connector-ui-job",
				source: "live",
				kind: "discover",
				state: "running",
				projectId: "connector-ui-project",
				projectRevision: 1,
				scope: [],
				reason: null,
				error: null,
				message: "Discovering",
				requestedAt: updatedAt,
				startedAt: updatedAt,
				updatedAt,
				completedAt: null,
				notBefore: updatedAt,
				progress: { completed: 12, total: 40 },
				observation: null,
				repositories: [],
			},
		],
	};
	let releaseCollector!: () => void;
	const collectorReady = new Promise<void>((resolve) => {
		releaseCollector = resolve;
	});
	await page.route("**/api/query/v1/collector?**", async (route) => {
		await collectorReady;
		await route.fulfill({ json: status });
	});
	await page.goto("/?source=cli");
	const panel = page.getByRole("region", { name: "Connector status" });
	const interval = panel.getByRole("combobox", {
		name: "Watched PR refresh cooldown",
	});
	await expect(
		panel.getByText("Reading status", { exact: true }),
	).toBeVisible();
	await expect(interval).toBeDisabled();
	const geometry = async () => ({
		panel: await panel.boundingBox(),
		interval: await interval.boundingBox(),
	});
	const loadingGeometry = await geometry();
	const expectStable = async (baseline = loadingGeometry) => {
		expect(await geometry()).toEqual(baseline);
		expect((await panel.boundingBox())!.height).toBeLessThan(180);
	};
	releaseCollector();
	await expect(panel.getByText("Online", { exact: true })).toBeVisible();
	await expect(panel.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"12",
	);
	await expect(
		page.locator("aside").getByRole("region", { name: "Connector status" }),
	).toHaveCount(1);
	await expect(
		page.getByRole("combobox", { name: "Watched PR refresh cooldown" }),
	).toHaveCount(1);
	await expect(
		panel.getByText("Oldest checks: 7m ago · 1 missing"),
	).toBeVisible();
	await expectStable();
	const runningJob = status.jobs[0]!;
	status.queue = { running: 0, queued: 0, authRequired: 0 };
	status.jobs = [];
	await page.clock.runFor(3100);
	await expect(panel.getByText("Next check in 3 min")).toBeVisible();
	await expect(panel.getByRole("progressbar")).toHaveCount(0);
	await expectStable();
	status.watching = 0;
	await page.clock.runFor(3100);
	await expect(panel.getByText("Ready to watch")).toBeVisible();
	await expectStable();
	status.watching = 16;
	status.queue = { running: 1, queued: 3, authRequired: 0 };
	status.jobs = [runningJob];
	await page.clock.runFor(3100);
	await expect(panel.getByRole("progressbar")).toBeVisible();
	await expectStable();
	const intervalWidth = (await interval.boundingBox())!.width;
	await interval.click();
	const menu = page.getByRole("listbox");
	await expect(menu).toBeVisible();
	expect(
		Math.abs((await menu.boundingBox())!.width - intervalWidth),
	).toBeLessThanOrEqual(1);
	const options = await page.getByRole("option").evaluateAll((items) =>
		items.map((item) => ({
			font: getComputedStyle(item).fontSize,
			wrap: getComputedStyle(item).whiteSpace,
			overflow: item.scrollWidth > item.clientWidth,
		})),
	);
	expect(options).toHaveLength(5);
	expect(
		options.every(
			(option) =>
				option.font === "11px" && option.wrap === "nowrap" && !option.overflow,
		),
	).toBe(true);
	await page.screenshot({ path: test.info().outputPath("connector-menu.png") });
	await page.keyboard.press("Escape");
	await page.goto("/developers?source=cli");
	await expect(panel.getByText("Online", { exact: true })).toBeVisible();
	await expectStable();
	let rejectSettings = true;
	let releaseSettings!: () => void;
	const settingsReady = new Promise<void>((resolve) => {
		releaseSettings = resolve;
	});
	await page.route("**/api/collection/settings", async (route) => {
		await settingsReady;
		if (rejectSettings)
			await route.fulfill({
				status: 503,
				json: { error: "Cannot save refresh cooldown" },
			});
		else {
			status.detailCooldownSeconds = 600;
			await route.continue();
		}
	});
	await interval.click();
	await page.getByRole("option", { name: "10 min", exact: true }).click();
	await expect(panel.getByText("Saving cooldown…")).toBeVisible();
	await expect(interval).toBeDisabled();
	await expectStable();
	releaseSettings();
	await expect(panel.getByRole("alert")).toHaveText(
		"Cannot save refresh cooldown",
	);
	await expect(interval).toHaveText("5 min");
	await expectStable();
	rejectSettings = false;
	await interval.click();
	await page.getByRole("option", { name: "10 min", exact: true }).click();
	await expect(panel.getByText("Watch refresh cooldown saved.")).toBeVisible();
	await expect(interval).toHaveText("10 min");
	await expect(panel.getByRole("alert")).toHaveCount(0);
	await expectStable();
	expect(
		collectorQuerySchema.parse(await cli("status")).detailCooldownSeconds,
	).toBe(600);
	status.connection = {
		state: "auth_required",
		lastSeenAt: updatedAt,
		message: "Another project needs sign-in",
	};
	status.queue.authRequired = 1;
	await page.clock.runFor(3100);
	await expect(
		panel.getByText("Sign-in required", { exact: true }),
	).toBeVisible();
	await expect(
		panel.getByText("Another project needs sign-in", { exact: true }),
	).toBeVisible();
	await expect(panel.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"12",
	);
	await expect(
		panel.getByText("Collection paused", { exact: true }),
	).toHaveCount(0);
	await expectStable();
	status.connection = {
		state: "offline",
		lastSeenAt: updatedAt,
		message: "Start signoff daemon to collect watched PRs",
	};
	await page.clock.runFor(3100);
	await expect(panel.getByText("Offline", { exact: true })).toBeVisible();
	await expect(panel.getByRole("progressbar")).toHaveCount(0);
	await expect(panel.getByText("Offline", { exact: true })).toHaveClass(
		/text-basalt-destructive/,
	);
	await expectStable();
	const longProblem =
		"Sign-in expired for a watched repository. Open the collector and sign in to resume checks for this project. Other projects can continue collecting normally.";
	status.connection.message = longProblem;
	await page.clock.runFor(3100);
	await expect(panel.getByText(longProblem, { exact: true })).toBeVisible();
	await expectStable();
	await page.screenshot({
		path: test.info().outputPath("connector-offline.png"),
	});
	await page.getByRole("button", { name: "Collapse sidebar" }).click();
	await expect(
		panel.getByRole("button", { name: /Connector offline.*Expand sidebar/ }),
	).toBeVisible();
	await panel
		.getByRole("button", { name: /Connector offline.*Expand sidebar/ })
		.click();
	await expect(interval).toBeVisible();
	await expect
		.poll(async () => (await panel.boundingBox())!.width)
		.toBe(loadingGeometry.panel!.width);
	await expectStable();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(panel).toBeVisible();
	await expect
		.poll(async () => (await panel.boundingBox())!.x)
		.toBe(loadingGeometry.panel!.x);
	const mobileGeometry = await geometry();
	status.connection = {
		state: "ready",
		lastSeenAt: updatedAt,
		message: "Connected",
	};
	status.queue = { running: 0, queued: 0, authRequired: 0 };
	status.jobs = [];
	await page.clock.runFor(3100);
	await expect(panel.getByText("Online", { exact: true })).toBeVisible();
	await expect(panel.getByRole("progressbar")).toHaveCount(0);
	await expectStable(mobileGeometry);
	await panel
		.getByRole("combobox", { name: "Watched PR refresh cooldown" })
		.click();
	await expect(menu).toBeVisible();
	expect(
		(await menu.boundingBox())!.x + (await menu.boundingBox())!.width,
	).toBeLessThanOrEqual(390);
	await page.screenshot({
		path: test.info().outputPath("connector-mobile.png"),
	});
});
