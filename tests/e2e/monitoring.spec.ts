import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { createCollectionClient } from "../../apps/collect/src/workbench/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import { demoWorkspace } from "../../packages/domain/src/demo";
import {
	batchCommandSchema,
	collectorQuerySchema,
	commandReceiptSchema,
	machinePageSchema,
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
	await page.getByRole("button", { name: /^Connector/ }).click();
	await expect(
		page.getByRole("combobox", { name: "Watched PR refresh cooldown" }),
	).toHaveText("5 min");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await page.request.patch(`${base}/api/collection/settings`, {
		data: { listCooldownSeconds: 0, detailCooldownSeconds: 0 },
	});
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
		loadingTable.getByRole("columnheader", { name: "Pull request" }),
	).toBeVisible();
	await expect(loadingTable.getByRole("checkbox")).toBeDisabled();
	const skeletonTable = await loadingTable.elementHandle();
	const skeletonHeight = (await loadingTable
		.locator("tbody tr")
		.first()
		.boundingBox())!.height;
	expect(skeletonHeight).toBe(64);
	await expect(
		loadingTable.locator("tbody tr").first().locator("td"),
	).toHaveCount(12);
	await page.screenshot({
		path: test.info().outputPath("pull-loading.png"),
		fullPage: true,
	});
	releaseList();
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(20);
	await expect(loadingTable).toHaveAttribute("aria-busy", "false");
	expect(
		(await page.locator("tr[data-pull-id]").first().boundingBox())!.height,
	).toBe(skeletonHeight);
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
	const measured = [];
	for (const width of [3200, 3840]) {
		await page.setViewportSize({ width, height: 1080 });
		measured.push({
			title: (await titleColumn.boundingBox())!.width,
			checks: (await checksColumn.boundingBox())!.width,
			action: (await actionColumn.boundingBox())!.width,
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			),
		).toBe(false);
		await page.screenshot({
			path: test.info().outputPath(`pull-wide-layout-${width}.png`),
			fullPage: true,
		});
	}
	expect(Math.abs(measured[1]!.title - measured[0]!.title)).toBeLessThan(2);
	expect(Math.abs(measured[1]!.action - measured[0]!.action)).toBeLessThan(2);
	expect(measured[1]!.checks - measured[0]!.checks).toBeGreaterThan(600);
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
	expect((await watchList()).data.map((watch) => watch.pr.id)).toEqual([
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
	expect((await watchList()).data.map((w) => w.pr.id).sort()).toEqual(
		ids.sort(),
	);
	const draftUrl = `${repoUrl(repos[1]!)}/pullrequest/2`;
	await cli("watch", "add", draftUrl);
	const watched = await watchList();
	expect(watched.data).toHaveLength(3);
	expect(watched.data.find((w) => w.pr.number === 2)?.pr).toMatchObject({
		provider: "ado",
		organization: "e2e-two",
		project: { name: "Équipe" },
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
		(watch) => watch.pr.id === staleId,
	)!.watch.generation;
	await page.locator("tr[data-pull-id]").first().getByRole("checkbox").check();
	await cli("watch", "remove", staleId!);
	await cli("watch", "add", staleId!);
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(page.getByText(/Watch generation changed/)).toBeVisible();
	expect(
		(await watchList()).data.find((w) => w.pr.id === staleId)?.watch.generation,
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
			(await watchList()).data.map(({ watch, pr }) => ({
				watch,
				pullId: pr.id,
			})),
		).toEqual(
			watchesBeforeEdit.map(({ watch, pr }) => ({ watch, pullId: pr.id })),
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
	// A CLI mutation and full detail publication must reconcile this mounted
	// page and its detail sheet without reloads or a Web provider command.
	await page.clock.fastForward(3100);
	await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	await page
		.getByRole("button", { name: "Open PR #2: Éditeur change 2", exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	const _watchedDraft = (await watchList()).data[0]!;

	const stateReads: string[] = [];
	const terminalProvider: AdoPagedClient = {
		...fakeAdo,
		get: async (url) => {
			if (!url.includes("/pullrequests/2?")) return { value: [] };
			stateReads.push(url);
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
		getPage: async () => ({ data: { value: [] }, continuationToken: null }),
	};
	const statusErrors: string[] = [];
	const terminalResult = await runCollectionOnce({
		api,
		makeAdo: () => terminalProvider,
		log: { ...silent, error: (message) => statusErrors.push(message) },
	});
	expect(terminalResult.state, statusErrors.join("\n")).toBe("complete");
	expect(stateReads).toHaveLength(1);

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
	expect((await watchList()).data[0]?.watch).toMatchObject({
		id: retainedWatch.watch.id,
		generation: retainedWatch.watch.generation,
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
	expect(renamedWatch[0]!.pr.repository).toEqual({
		id: "repository-two",
		name: "Éditeur-renamed",
	});
	await patchUnicodeProject({
		description: "Metadata edit after provider rename",
	});
	expect((await watchList()).data[0]).toMatchObject({
		watch: {
			id: renamedWatch[0]!.watch.id,
			generation: renamedWatch[0]!.watch.generation,
			active: true,
		},
		pr: { id: renamedPull.data.id },
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
		id: currentWatch.watch.id,
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
	// Keep list evidence unavailable so this exercises the first-load detail error.
	await page.route("**/api/query/v1/prs?**", (route) =>
		route.fulfill({ status: 503, json: { error: "List unavailable" } }),
	);
	await page.goto(`/?pr=${encodeURIComponent(detailPull.id)}`);
	await expect(
		page.getByRole("heading", { name: "Unable to load PR details" }),
	).toBeVisible();
	await expect(page.getByText("PR not found", { exact: true })).toHaveCount(0);
	await page.unroute("**/api/query/v1/prs/*?**");
	await page.unroute("**/api/query/v1/prs?**");
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

test("policy instructions persist with priority, scope and cached Jev errors", async ({
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

	const machineUrl = `${base}/api/state-machines/${projectId}?source=live&repositoryId=${repo.id}`;
	await page.goto(
		`/policy-instructions/ado/${repo.org}/${repo.project}/${repo.name}`,
	);
	const area = page
		.getByRole("textbox", { name: "Meaning and human action instructions" })
		.first();
	await area.fill(
		"A person should approve this gate after checking the provider evidence.",
	);
	await page
		.getByRole("button", { name: "Save policy instructions", exact: true })
		.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Policy instructions saved" }),
	).toContainText("Policy instructions saved");
	await page.reload();
	await expect(area).toHaveValue(
		"A person should approve this gate after checking the provider evidence.",
	);
	const configured = machinePageSchema.parse(
		await (await page.request.get(machineUrl)).json(),
	);
	expect(configured.inherited).toBe(false);
	const aiInput = { source: "cli" };
	for (let i = 0; i < 30; i++) {
		const tick = await (
			await page.request.post(`${base}/api/ai/tick`, { data: aiInput })
		).json();
		if (!tick.processed) break;
	}
	const judged = pullDetailSchema.parse(await cli("pr", "get", pull.id));
	expect(judged.data.readiness.status).toBe("error");
	expect(judged.data.readiness.current).toBeNull();
	await page.goto(`/prs?watching=watching`);
	await expect(page.getByText("Error", { exact: true }).first()).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(
		`/policy-instructions/ado/${repo.org}/${repo.project}/${repo.name}`,
	);
	await expect(area).toBeVisible();
	await area.fill("Wait for the project owner to approve this policy.");
	await page
		.getByRole("button", { name: "Save policy instructions", exact: true })
		.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Policy instructions saved" }),
	).toBeVisible();
	await page.request.post(`${base}/api/ai/tick`, { data: aiInput });
	const pending = pullDetailSchema.parse(await cli("pr", "get", pull.id));
	expect(pending.data.readiness.status).toBe("pending");
	expect(pending.data.readiness.current).toBeNull();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto(`/sm/ado/${repo.org}/${repo.project}/${repo.name}?pr=1`);
	const graph = page.getByRole("region", { name: "State machine graph" });
	await expect(graph).toHaveAttribute("aria-busy", "false");
	await expect(
		page.getByRole("combobox", { name: "Trace pull request" }),
	).toContainText(pull.title);
	expect(
		await graph.locator(".react-flow__node-machine").count(),
	).toBeGreaterThan(10);
	await page.getByRole("button", { name: "Focus PR", exact: true }).click();
	await page.getByRole("button", { name: "Inspect", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Evidence inspector" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Close inspector" }).click();
	await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Observation history" }),
	).toBeVisible();
	await expect(
		page.getByRole("complementary", { name: "State machine inspector" }),
	).toContainText("not historical Jev judgments");
	await page.getByRole("button", { name: "Close inspector" }).click();
	await page.getByRole("button", { name: "Transitions", exact: true }).click();
	await expect(graph).toHaveAttribute("aria-busy", "false");
	await page.getByRole("button", { name: "Model", exact: true }).click();
	await expect(graph).toHaveAttribute("aria-busy", "false");
	await page.getByRole("button", { name: "Fit entire graph" }).click();
	await page.getByRole("button", { name: "Auto layout" }).click();
	await expect(graph).toHaveAttribute("aria-busy", "false");
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(graph).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.reload();
	await expect(
		page.getByRole("combobox", { name: "Trace pull request" }),
	).toContainText(pull.title);
	await page
		.getByRole("link", { name: "Policy instructions", exact: true })
		.click();
	await expect(area).toHaveValue(
		"Wait for the project owner to approve this policy.",
	);

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
	expect(remaining.data.map((watch) => watch.pr.repository.id)).toEqual([id]);
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

test("discovery refreshes full history, retries partial pages and respects manual mode", async ({
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
	const discover = async () => {
		const receipt = commandReceiptSchema.parse(
			await cli("discover", "--repo", url),
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
	await page.request.patch(`${base}/api/collection/settings`, {
		data: { listCooldownSeconds: 0 },
	});
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
	expect(calls[0]!.searchParams.get("searchCriteria.minTime")).toBeNull();
	failSecondPage = false;
	expect((await discover()).state).toBe("complete");
	expect(calls).toHaveLength(4);
	const after = await list();
	expect(after.data).toHaveLength(380);
	expect(new Set(after.data.map((pull) => pull.id)).size).toBe(380);
	expect(after.data.find((pull) => pull.number === 379)?.state).toBe("draft");
	mergedFirst = true;
	expect((await discover()).state).toBe("complete");
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

test("collector dialog persists all three cooldowns with background evaluation and mobile layout", async ({
	page,
}) => {
	await page.goto("/prs");
	const panel = page.getByRole("region", { name: "Connector status" });
	await expect(panel).toBeVisible();
	expect((await panel.boundingBox())!.height).toBeLessThan(180);
	await panel.getByRole("button").click();
	const dialog = page.getByRole("dialog", { name: "Collector details" });
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("region", { name: "Jev scheduling" }),
	).toContainText("dashboard closed");
	await expect(
		dialog.getByRole("combobox", { name: "Project discovery cooldown" }),
	).toBeVisible();
	await expect(
		dialog.getByRole("combobox", { name: "Watched PR refresh cooldown" }),
	).toBeVisible();
	const jevCooldown = dialog.getByRole("combobox", {
		name: "Jev evaluation cooldown",
	});
	await expect(jevCooldown).toHaveText("5 min");
	await jevCooldown.click();
	await page.getByRole("option", { name: "10 min", exact: true }).click();
	await expect(jevCooldown).toHaveText("10 min");
	await page.reload();
	await panel.getByRole("button").click();
	await expect(jevCooldown).toHaveText("10 min");
	await jevCooldown.click();
	await page.getByRole("option", { name: "5 min", exact: true }).click();
	await expect(jevCooldown).toHaveText("5 min");
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.getByRole("button", { name: "Open navigation", exact: true })
		.click();
	await panel.getByRole("button").click();
	await expect(jevCooldown).toBeVisible();
	expect(await dialog.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(
		false,
	);
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
});

test("friendly workspace URLs survive history, reload and sharing without changing rule scope", async ({
	page,
	browser,
}) => {
	const repo = {
		org: "e2e-urls",
		project: "URL space",
		id: "url-repository",
		name: "routes + 100%",
		projectGuid: "url-project",
	};
	repos.push(repo);
	await cli("repo", "add", repoUrl(repo));
	const scopePath = `ado/${repo.org}/${encodeURIComponent(repo.project)}`;
	const repositoryPath = `${scopePath}/${encodeURIComponent(repo.name)}`;
	await page.goto(`/sm/${repositoryPath}`);
	await expect(page.getByRole("alert")).toContainText(
		"Repository address is not collected",
	);
	await expect(
		page.getByRole("region", { name: "State machine graph" }),
	).toHaveCount(0);
	await expect
		.poll(() => new URL(page.url()).pathname)
		.toBe(`/sm/${repositoryPath}`);
	const discovery = commandReceiptSchema.parse(
		await cli("discover", "--repo", repoUrl(repo)),
	);
	expect((await execute(false, discovery.jobs[0]!.id)).state).toBe("complete");
	await cli("watch", "add", `${repoUrl(repo)}/pullrequest/1`);
	const pull = pullDetailSchema.parse(
		await cli("pr", "get", `${repoUrl(repo)}/pullrequest/1`),
	).data;
	const providerReads = providerRequests;
	const watches = await watchList();
	const detailPath = `/prs/${repositoryPath}/1`;
	await page.goto(`/prs?source=live&org=${repo.org}`);
	await page.getByRole("combobox", { name: "Project", exact: true }).click();
	await page.getByRole("option", { name: repo.project, exact: true }).click();
	await page.getByRole("combobox", { name: "Repository", exact: true }).click();
	await page.getByRole("option", { name: repo.name, exact: true }).click();
	await page.getByRole("textbox", { name: "Search PRs" }).fill("change");
	await page.getByRole("combobox", { name: "Draft", exact: true }).click();
	await page
		.getByRole("option", { name: "Include drafts", exact: true })
		.click();
	await page.getByRole("button", { name: "Watched", exact: true }).click();
	await page.getByRole("button", { name: "All states", exact: true }).click();
	const sort = page.getByRole("button", {
		name: "Sort by Pull request",
		exact: true,
	});
	await sort.click();
	await sort.click();
	const preferencesUrl = new URL(page.url());
	preferencesUrl.searchParams.sort();
	const storedPreferences = () =>
		page.evaluate(() => localStorage.getItem("signoff-pull-filters"));
	const preferences = await storedPreferences();
	expect(Object.fromEntries(new URLSearchParams(preferences!))).toEqual({
		source: "live",
		org: repo.org,
		project: pull.project.id,
		repo: repo.id,
		q: "change",
		draft: "include",
		watching: "watching",
		state: "all",
		sort: "title",
		direction: "desc",
	});
	const expectPreferences = async () => {
		await expect(page).toHaveURL((url) => {
			url.searchParams.sort();
			return url.href === preferencesUrl.href;
		});
		await expect(page.getByRole("textbox", { name: "Search PRs" })).toHaveValue(
			"change",
		);
		await expect(
			page.getByRole("combobox", { name: "Repository", exact: true }),
		).toHaveText(repo.name);
		await expect(
			page.getByRole("combobox", { name: "Draft", exact: true }),
		).toHaveText("Include drafts");
		await expect(
			page.getByRole("button", { name: "Watched", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "All states", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("columnheader", {
				name: "Sort by Pull request",
				exact: true,
			}),
		).toHaveAttribute("aria-sort", "descending");
		await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
	};
	await page.reload();
	await expectPreferences();
	await page.goto("/prs");
	await expectPreferences();
	await page.goto(`/sm/${repositoryPath}?pr=1`);
	await expect(
		page.getByRole("combobox", { name: "State machine repository" }),
	).toHaveText(repo.name);
	expect(await storedPreferences()).toBe(preferences);
	await page
		.getByRole("button", { name: "Pull requests", exact: true })
		.click();
	await expectPreferences();
	let documents = 0;
	page.on("request", (request) => {
		if (request.resourceType() === "document") documents++;
	});
	await page.goto(`/?pr=${encodeURIComponent(pull.id)}`);
	await expect(
		page.getByRole("heading", { name: pull.title, exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(`${base}${detailPath}`);
	const loadedDocuments = documents;
	await page
		.getByRole("button", { name: "Close pull request details" })
		.click();
	await expect(page).toHaveURL(`${base}/prs?source=live`);
	await page.goBack();
	await expect(
		page.getByRole("heading", { name: pull.title, exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(`${base}${detailPath}`);
	await page.goForward();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(documents).toBe(loadedDocuments);
	await page.goBack();
	await page.reload();
	await expect(
		page.getByRole("heading", { name: pull.title, exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(`${base}${detailPath}`);

	await page.goto(`/sm/${scopePath}`);
	const repository = page.getByRole("combobox", {
		name: "State machine repository",
	});
	await expect(repository).toHaveText("Project default");
	await repository.click();
	await page.getByRole("option", { name: repo.name, exact: true }).click();
	await expect
		.poll(() => new URL(page.url()).pathname)
		.toBe(`/sm/${repositoryPath}`);
	await page.reload();
	await expect(repository).toHaveText(repo.name);
	const fresh = await browser.newContext();
	try {
		const shared = await fresh.newPage();
		await shared.goto(`${base}/sm/${repositoryPath}`);
		await expect(
			shared.getByRole("combobox", { name: "State machine repository" }),
		).toHaveText(repo.name);
	} finally {
		await fresh.close();
	}

	expect(providerRequests).toBe(providerReads);
	const after = await watchList();
	// Daemon inference can publish a new readiness revision without changing watch membership.
	expect(after.data.map(({ pull: _pull, ...watch }) => watch)).toEqual(
		watches.data.map(({ pull: _pull, ...watch }) => watch),
	);
});

test("browsers never drive inference on focus changes or reload", async ({
	browserName,
}, testInfo) => {
	expect(browserName).toBe("chromium");
	const directory = mkdtempSync(path.join(tmpdir(), "signoff-focus-"));
	const child = spawn(
		testInfo.project.use.launchOptions?.executablePath ??
			chromium.executablePath(),
		[
			"--remote-debugging-port=0",
			`--user-data-dir=${directory}`,
			"--no-first-run",
			"--no-default-browser-check",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	try {
		let port = "";
		await expect
			.poll(() => {
				try {
					port = readFileSync(
						path.join(directory, "DevToolsActivePort"),
						"utf8",
					).split("\n")[0]!;
					return !!port;
				} catch {
					return false;
				}
			})
			.toBe(true);
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
			noDefaults: true,
		});
		const context = browser.contexts()[0]!;
		const page = context.pages()[0]!;
		let ticks = 0;
		page.on("request", (request) => {
			if (
				["/api/ai/tick", "/api/ai/presence"].includes(
					new URL(request.url()).pathname,
				)
			)
				ticks++;
		});
		await page.goto(`${base}/prs`);
		await expect(
			page.getByRole("heading", { name: "Pull requests", exact: true }),
		).toBeVisible();
		await page.bringToFront();
		await page.waitForTimeout(6000);
		expect(ticks).toBe(0);
		const other = await context.newPage();
		await other.goto("about:blank");
		await other.bringToFront();
		await expect
			.poll(() => page.evaluate(() => document.hasFocus()))
			.toBe(false);
		const before = ticks;
		await page.waitForTimeout(6000);
		expect(ticks).toBe(before);
		await page.bringToFront();
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Pull requests", exact: true }),
		).toBeVisible();
		await page.waitForTimeout(6000);
		expect(ticks).toBe(0);
		await browser.close();
	} finally {
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			if (child.exitCode !== null) resolve();
			else child.once("exit", () => resolve());
		});
		rmSync(directory, { recursive: true, force: true });
	}
});

test("collections persist all PR states, multiple memberships and compact CRUD flows", async ({
	page,
}) => {
	test.setTimeout(120000);
	const repo = {
		org: "e2e-collections",
		project: "Collection space",
		id: "collection-repository",
		name: "collection-flow",
		projectGuid: "collection-project",
	};
	repos.push(repo);
	await cli("repo", "add", repoUrl(repo));
	const discovery = commandReceiptSchema.parse(
		await cli("discover", "--repo", repoUrl(repo)),
	);
	expect((await execute(false, discovery.jobs[0]!.id)).state).toBe("complete");
	const providerReads = providerRequests;
	const beforeWatches = (await watchList()).data.map(
		({ pull: _pull, ...watch }) => watch,
	);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/collections?source=live");
	await expect(
		page.getByRole("button", { name: "Collections", exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "New collection", exact: true })
		.first()
		.click();
	await page
		.getByLabel("Collection name", { exact: true })
		.fill("Release quality");
	await page
		.getByLabel("Collection purpose")
		.fill("Track the complete testing effort.");
	await page.getByRole("button", { name: "flask icon" }).click();
	await page.getByRole("button", { name: "teal color" }).click();
	await page
		.getByRole("button", { name: "Create collection", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Release quality", exact: true }),
	).toBeVisible();
	const collectionUrl = page.url();
	const collectionId = new URL(collectionUrl).pathname.split("/").at(-1)!;
	await page
		.getByRole("button", { name: "Add PRs", exact: true })
		.first()
		.click();
	await page.getByLabel("Find PRs to add").fill("collection-flow change");
	await expect(
		page.getByText("0 selected · 26 matching PRs", { exact: true }),
	).toBeVisible();
	const candidates = page.getByRole("region", { name: "PR candidates" });
	await expect(candidates.getByRole("checkbox").first()).toBeEnabled();
	for (const checkbox of await candidates.getByRole("checkbox").all())
		await checkbox.check();
	await page.getByRole("button", { name: "Next candidate page" }).click();
	await expect(candidates.getByRole("checkbox")).toHaveCount(6);
	await expect(candidates.getByRole("checkbox").first()).toBeEnabled();
	for (const checkbox of await candidates.getByRole("checkbox").all())
		await checkbox.check();
	await page.getByRole("button", { name: "Add 26 PRs", exact: true }).click();
	const rows = page.locator("tr[data-pull-id]");
	await expect(rows).toHaveCount(26);
	await expect(
		page.getByRole("button", { name: "Next page", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("img", {
			name: "1 merged, 23 open, 1 draft, 1 closed out of 26",
		}),
	).toBeVisible();
	await page.reload();
	await expect(rows).toHaveCount(26);
	const filters = page.getByRole("region", { name: "PR filters" });
	await filters.getByRole("button", { name: "Draft", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await page.reload();
	await expect(
		filters.getByRole("button", { name: "Draft", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(1);
	await filters.getByRole("button", { name: "Open", exact: true }).click();
	await expect(rows).toHaveCount(23);
	await expect(
		filters.getByRole("button", { name: "Draft", exact: true }),
	).toContainText("1");
	for (const state of ["Merged", "Closed"]) {
		await filters.getByRole("button", { name: state, exact: true }).click();
		await expect(rows).toHaveCount(1);
	}
	await filters
		.getByRole("button", { name: "All states", exact: true })
		.click();
	await expect(rows).toHaveCount(26);
	await page
		.getByRole("button", { name: "Edit collection", exact: true })
		.click();
	await page
		.getByLabel("Collection name", { exact: true })
		.fill("Release quality updated");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Release quality updated", exact: true }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.screenshot({
		path: test.info().outputPath("collections-mobile.png"),
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	const second = await (
		await page.request.post("/api/pr-collections", {
			data: {
				name: "Also tracked",
				description: "Secondary purpose",
				icon: "flag",
				color: "amber",
			},
		})
	).json();
	await page.goto(`/prs?source=live&org=${repo.org}&draft=include&state=all`);
	const membershipMarker = page.getByRole("button", {
		name: "Collections for PR #1",
		exact: true,
	});
	await membershipMarker.hover();
	await expect(page.getByRole("tooltip")).toContainText(
		"Release quality updated",
	);
	await membershipMarker.click();
	await page
		.getByRole("checkbox", { name: "Also tracked", exact: true })
		.click();
	await expect(
		page.getByRole("checkbox", { name: "Also tracked", exact: true }),
	).toBeChecked();
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await page.reload();
	await expect(membershipMarker).toContainText("2");
	await membershipMarker.hover();
	await expect(page.getByRole("tooltip")).toContainText("Also tracked");
	await expect(page.getByRole("tooltip")).toContainText(
		"Release quality updated",
	);
	await page.goto(collectionUrl);
	const memberTable = page.getByRole("table", {
		name: "Collection pull requests",
	});
	await expect(memberTable).toHaveAttribute("aria-busy", "false");
	const watchButton = memberTable.getByRole("button", {
		name: "Watch PR #1 in Collection space/collection-flow",
		exact: true,
	});
	await watchButton.click();
	await expect(watchButton).toHaveAttribute("aria-pressed", "true");
	await expect(watchButton).toBeEnabled();
	await page.reload();
	await expect(watchButton).toHaveAttribute("aria-pressed", "true");
	await watchButton.click();
	await expect(watchButton).toHaveAttribute("aria-pressed", "false");
	await expect(watchButton).toBeEnabled();
	const sortTitle = memberTable.getByRole("button", {
		name: "Sort by Pull request",
		exact: true,
	});
	await sortTitle.click();
	await expect(
		memberTable.getByRole("columnheader", {
			name: "Sort by Pull request",
			exact: true,
		}),
	).toHaveAttribute("aria-sort", "ascending");
	await filters.getByRole("button", { name: "Draft", exact: true }).click();
	await page.reload();
	await expect(rows).toHaveCount(1);
	await expect(
		memberTable.getByRole("columnheader", {
			name: "Sort by Pull request",
			exact: true,
		}),
	).toHaveAttribute("aria-sort", "ascending");
	await page.goto(`/collections/${second.id}?source=live`);
	await expect(
		filters.getByRole("button", { name: "All states", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		memberTable.getByRole("columnheader", {
			name: "Sort by PR updated",
			exact: true,
		}),
	).toHaveAttribute("aria-sort", "descending");
	await filters.getByRole("button", { name: "Closed", exact: true }).click();
	await memberTable
		.getByRole("button", { name: "Sort by Readiness", exact: true })
		.click();
	await page.reload();
	await expect(
		filters.getByRole("button", { name: "Closed", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		memberTable.getByRole("columnheader", {
			name: "Sort by Readiness",
			exact: true,
		}),
	).toHaveAttribute("aria-sort", "ascending");
	await page.goto(collectionUrl);
	await expect(
		filters.getByRole("button", { name: "Draft", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(1);
	await expect(
		memberTable.getByRole("columnheader", {
			name: "Sort by Pull request",
			exact: true,
		}),
	).toHaveAttribute("aria-sort", "ascending");
	await filters
		.getByRole("button", { name: "All states", exact: true })
		.click();
	await expect(rows).toHaveCount(26);

	await expect(
		memberTable.locator("tbody tr[data-pull-id]").first(),
	).toHaveClass(/h-16/);
	await page
		.getByRole("button", { name: "Remove PR #1 from collection", exact: true })
		.click();
	await expect(
		page.getByRole("img", {
			name: "1 merged, 22 open, 1 draft, 1 closed out of 25",
		}),
	).toBeVisible();
	await memberTable
		.getByRole("checkbox", { name: "Select all collection PRs" })
		.check();
	await expect(
		memberTable.getByRole("checkbox", { checked: true }),
	).toHaveCount(26);
	await page
		.getByRole("button", { name: "Add to watch list", exact: true })
		.click();
	await expect(
		memberTable.locator('button[aria-label^="Watch PR"][aria-pressed="true"]'),
	).toHaveCount(23);
	await expect(
		page.getByRole("button", { name: "Remove from collection", exact: true }),
	).toBeEnabled();
	const watchesAfterBulk = (await watchList()).data.map(
		({ pull: _pull, ...watch }) => watch,
	);
	expect(watchesAfterBulk).toEqual(expect.arrayContaining(beforeWatches));
	expect(watchesAfterBulk.length).toBe(beforeWatches.length + 23);

	await page
		.getByRole("button", { name: "Remove from collection", exact: true })
		.click();
	await expect(rows).toHaveCount(0);
	await page.reload();
	await expect(rows).toHaveCount(0);
	await expect(
		page.getByText("Your collection is ready", { exact: true }),
	).toBeVisible();

	await page
		.getByRole("button", { name: "Delete collection", exact: true })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete collection", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Collections", exact: true }),
	).toBeVisible();
	expect(
		(await page.request.get(`/api/pr-collections/${collectionId}`)).status(),
	).toBe(404);
	const remaining = await (
		await page.request.get(`/api/pr-collections/${second.id}`)
	).json();
	expect(remaining.counts.total).toBe(1);
	await page.goto("/collections?source=sample");
	await expect(
		page.getByRole("heading", { name: "Collections", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link").filter({ hasText: "Also tracked" }),
	).toHaveCount(0);
	expect(providerRequests).toBe(providerReads);
	expect(
		(await watchList()).data.map(({ pull: _pull, ...watch }) => watch),
	).toEqual(watchesAfterBulk);
	expect(errors).toEqual([]);
});
