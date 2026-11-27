import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import {
	collectorQuerySchema,
	commandReceiptSchema,
	observationListSchema,
	pullDetailSchema,
	pullListSchema,
	repoListSchema,
} from "../../packages/domain/src/query";
import {
	DISCOVERY_HISTORY_DAYS,
	projectSchema,
} from "../../packages/domain/src/workbench";
import {
	api,
	base,
	cli,
	execute,
	fakeAdo,
	getProviderRequests,
	markMonitoringDone,
	now,
	repos,
	repoUrl,
	root,
	silent,
	watchList,
	withWatchLock,
} from "./monitoring-helpers";

test("Web and CLI share persisted watches; discovery is explicit and terminal refresh retires atomically", async ({
	page,
}) => {
	// The full lifecycle runs many real CLI subprocesses alongside browser I/O.
	test.slow();
	await withWatchLock(
		"exclusive",
		async () => {
			await page.clock.install();
			const browserErrors: string[] = [];
			page.on("pageerror", (error) => browserErrors.push(error.message));
			expect(collectorQuerySchema.parse(await cli("status")).watching).toBe(0);
			await page.goto("/");
			await expect(
				page.getByRole("heading", { name: "Pull requests", exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: /^Connector / }).click();
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
			expect(getProviderRequests()).toBe(0);
			for (const repo of repos) {
				await cli("discover", "--repo", repoUrl(repo));
				expect((await execute()).state).toBe("complete");
			}
			const all = pullListSchema.parse(
				await cli(
					"pr",
					"list",
					"--state",
					"all",
					"--draft",
					"include",
					"--all",
				),
			);
			expect(all.data).toHaveLength(52);
			expect(all.data.some((pr) => pr.state === "draft")).toBe(true);
			expect(all.data.some((pr) => pr.state === "merged")).toBe(true);
			expect(all.data.some((pr) => pr.state === "closed")).toBe(true);
			expect((await watchList()).data).toEqual([]);
			const before = getProviderRequests();
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
			expect(skeletonHeight).toBeGreaterThanOrEqual(60);
			expect(skeletonHeight).toBeLessThanOrEqual(80);
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
			const loadedHeight = (await page
				.locator("tr[data-pull-id]")
				.first()
				.boundingBox())!.height;
			expect(Math.abs(loadedHeight - skeletonHeight)).toBeLessThanOrEqual(16);
			expect(
				await skeletonTable!.evaluate((element) => element.isConnected),
			).toBe(true);
			await page.unroute("**/api/query/v1/prs?**");
			const filters = page.getByRole("region", {
				name: "PR filters",
				exact: true,
			});
			const results = page.getByRole("region", {
				name: "PR results",
				exact: true,
			});
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
				(await filters.boundingBox())!.y +
					(await filters.boundingBox())!.height,
			).toBeLessThan((await results.boundingBox())!.y);
			const selectAll = page.getByRole("checkbox", {
				name: "Select all eligible PRs on this page",
			});
			await selectAll.check();
			await expect(
				page.getByText("20 selected", { exact: true }),
			).toBeVisible();
			expect((await watchList()).data).toEqual([]);
			expect(getProviderRequests()).toBe(before);
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
			await page
				.getByRole("button", { name: "Next page", exact: true })
				.click();
			await expect(
				page.getByText("Unable to load pull requests"),
			).toBeVisible();
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
			expect(Math.abs(measured[1]!.action - measured[0]!.action)).toBeLessThan(
				2,
			);
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
			expect(
				await originalTable!.evaluate((element) => element.isConnected),
			).toBe(true);
			expect((await table.boundingBox())!.y).toBe(tableTop);
			releaseWatch();
			await expect(toggle).toHaveAttribute("aria-busy", "false");
			await page.unroute("**/api/commands/v1/observations");
			expect((await table.boundingBox())!.y).toBe(tableTop);
			await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
			expect((await watchList()).data.map((watch) => watch.pr.id)).toEqual([
				ids[0],
			]);
			const collection = page.getByRole("region", {
				name: "Connector status",
			});
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
				page.getByText("2 PRs added to the shared watch list.", {
					exact: true,
				}),
			).toBeVisible();
			expect(
				(await watchList()).data
					.map((w) => w.pr.id)
					.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
			).toEqual(ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
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
			await page
				.locator("tr[data-pull-id]")
				.first()
				.getByRole("checkbox")
				.check();
			await cli("watch", "remove", staleId!);
			await cli("watch", "add", staleId!);
			await page
				.getByRole("button", { name: "Remove from watch list", exact: true })
				.click();
			await expect(page.getByText(/Watch generation changed/)).toBeVisible();
			expect(
				(await watchList()).data.find((w) => w.pr.id === staleId)?.watch
					.generation,
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
			// Advance past the 15 s poll; the fake timer may not be armed until the
			// previous read settles, so keep advancing until the failure shows.
			await expect(async () => {
				await page.clock.fastForward(16000);
				await expect(page.getByText(/Temporary PR cache failure/)).toBeVisible({
					timeout: 1000,
				});
			}).toPass({ timeout: 20000 });
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(3);
			await page.unroute("**/api/query/v1/prs?**");
			await expect(async () => {
				await page.clock.fastForward(16000);
				await expect(page.getByText(/Temporary PR cache failure/)).toHaveCount(
					0,
					{
						timeout: 1000,
					},
				);
			}).toPass({ timeout: 20000 });
			const beforeSourceSwitch = getProviderRequests();
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
			expect(getProviderRequests()).toBe(beforeSourceSwitch);
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
					watchesBeforeEdit.map(({ watch, pr }) => ({
						watch,
						pullId: pr.id,
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
			// A CLI mutation and full detail publication must reconcile this mounted
			// page and its detail sheet without reloads or a Web provider command.
			await page.clock.fastForward(3100);
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
			await page
				.getByRole("button", {
					name: "Open PR #2: Éditeur change 2",
					exact: true,
				})
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
				getPage: async () => ({
					data: { value: [] },
					continuationToken: null,
				}),
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
			expect((await watchList()).data[0]?.watch).toMatchObject({
				active: false,
				stopReason: "completed",
			});
			await page.getByRole("button", { name: "Merged", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "Watched", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
			await page.getByRole("button", { name: "Watched", exact: true }).click();
			await page.getByRole("button", { name: "Watched", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "Merged", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
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
			expect(final.data.find((p) => p.number === 2)?.observation).toMatchObject(
				{
					active: false,
					stopReason: "completed",
				},
			);
			const retired = (await watchList()).data[0]!;
			await cli("discover", "--repo", repoUrl(repos[1]!));
			expect((await execute()).state).toBe("complete");
			expect((await watchList()).data[0]?.watch).toMatchObject({
				id: retired.watch.id,
				generation: retired.watch.generation + 1,
				active: true,
				stopReason: null,
			});
			expect((await execute()).state).toBe("complete");
			await page.clock.fastForward(3100);
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(0);
			await page.getByRole("button", { name: "Open", exact: true }).click();
			await page.getByRole("combobox", { name: "Draft", exact: true }).click();
			await page
				.getByRole("option", { name: "Include drafts", exact: true })
				.click();
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
			await page.getByRole("button", { name: /^Watch PR #2 in/ }).click();
			await expect(page.locator("tr[data-pull-id]")).toHaveCount(0);
			expect((await watchList()).data).toEqual([]);
			expect(
				observationListSchema
					.parse(await cli("watch", "list", "--include-stopped", "--all"))
					.data.find((item) => item.pr?.number === 2)?.watch.stopReason,
			).toBe("manual");
			await page.getByRole("button", { name: "Open", exact: true }).click();
			expect((await execute()).state).toBe("idle");
			expect(repoListSchema.parse(await cli("repo", "list")).data).toHaveLength(
				2,
			);
			// Provider renames keep old URLs usable and cannot create a second watch identity.
			const previousRepoUrl = repoUrl(repos[1]!);
			const retainedUrl = `${previousRepoUrl}/pullrequest/5`;
			await cli("watch", "add", retainedUrl);
			expect((await execute()).state).toBe("complete");
			const retainedWatch = (await watchList()).data[0]!;
			repos[1]!.name = "Éditeur-renamed";
			await cli("discover", "--repo", previousRepoUrl);
			expect((await execute()).state).toBe("complete");
			const catalogAfterRename = repoListSchema.parse(
				await cli("repo", "list"),
			);
			expect(catalogAfterRename.page.total).toBe(2);
			expect(catalogAfterRename.coverage.state).toBe("complete");
			await cli("refresh", "--pr", retainedUrl);
			expect((await execute()).state).toBe("complete");
			const catalogAfterRefresh = repoListSchema.parse(
				await cli("repo", "list"),
			);
			expect(
				catalogAfterRefresh.data.find(
					(repo) => repo.repository.id === repos[1]!.id,
				)?.repository.name,
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
			const renamedPull = pullDetailSchema.parse(
				await cli("pr", "get", draftUrl),
			);
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
					getPage: async () => ({
						data: { value: [] },
						continuationToken: null,
					}),
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
								project: {
									id: repos[0]!.projectGuid,
									name: repos[0]!.project,
								},
							},
						};
					},
				};
				expect(
					(
						await runCollectionOnce({
							api,
							makeAdo: () => provider,
							log: silent,
						})
					).state,
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
			await cli("watch", "remove", slowUrl);
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
				page.getByText("1 PR removed from the shared watch list.", {
					exact: true,
				}),
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
			// The first failed read backs off before the retry that renders the error.
			await expect(
				pending.getByText(/Pending watches unavailable/),
			).toBeVisible({
				timeout: 20000,
			});
			await page.unroute("**/api/query/v1/observations?**");
			await pending
				.getByRole("button", { name: "Retry pending watches" })
				.click();
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
			await pending
				.getByRole("button", { name: "Previous pending page" })
				.click();
			await expect(pending.getByRole("link")).toHaveCount(20);
			await page.unroute("**/api/query/v1/observations?**");
			await pending.getByRole("button", { name: "Next pending page" }).click();
			await expect(pending.getByRole("link")).toHaveCount(1);
			await expect(pending.getByRole("link")).toHaveText(/#1020/);
			await pending
				.getByRole("button", { name: "Remove", exact: true })
				.click();
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
			await expect(page.getByText("PR not found", { exact: true })).toHaveCount(
				0,
			);
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
			await expect(
				page.getByText(/Queued discovery for 1 project/),
			).toBeVisible();
			const providerBeforeSample = getProviderRequests();
			// Catalogue discovery fans out one child task per sample repository.
			for (let run = await execute(); run.processed; run = await execute())
				expect(run.state).toBe("complete");
			expect(getProviderRequests()).toBe(providerBeforeSample);
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
		},
		{ waitForMonitoring: false },
	);
});

test("discovery refreshes full history, retries partial pages and respects manual mode", async ({
	page,
}) => {
	await withWatchLock(
		"exclusive",
		async () => {
			try {
				const repository = { id: "incremental-repo", name: "incremental" };
				const externalProject = {
					id: "incremental-project",
					name: "Incremental",
				};
				const url =
					"https://dev.azure.com/e2e-incremental/Incremental/_git/incremental";
				let total = 250;
				let failSecondPage = false;
				let mergedFirst = false;
				let calls: URL[] = [];
				const provider: AdoPagedClient = {
					...fakeAdo,
					checkAuth: async () => undefined,
					getPage: async (value) => {
						const request = new URL(value);
						if (request.pathname.endsWith("/repositories"))
							return {
								data: { value: [{ ...repository, project: externalProject }] },
								continuationToken: null,
							};
						calls.push(request);
						expect(request.searchParams.get("searchCriteria.status")).toBe(
							"all",
						);
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
								creationDate: new Date(
									(now - 2000 + number) * 1000,
								).toISOString(),
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
				// Discovery always bounds history to the 90-day contribution window.
				const withinHistoryWindow = (request: URL) => {
					const min = request.searchParams.get("searchCriteria.minTime");
					return (
						min !== null &&
						Date.parse(min) >=
							(now - DISCOVERY_HISTORY_DAYS * 86400 - 60) * 1000
					);
				};
				const discover = async (depth: "smart" | "deep" = "smart") => {
					const receipt = commandReceiptSchema.parse(
						depth === "smart"
							? await cli("discover", "--repo", url)
							: await (
									await page.request.post(`${base}/api/commands/v1/discover`, {
										data: { repositoryUrl: url, depth },
									})
								).json(),
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
				expect(calls.every(withinHistoryWindow)).toBe(true);
				expect((await list()).data).toHaveLength(250);
				total = 380;
				expect((await discover()).state).toBe("complete");
				expect(calls).toHaveLength(4);
				expect(calls.map((call) => call.searchParams.get("$skip"))).toEqual([
					"0",
					"100",
					"200",
					"300",
				]);
				expect(
					calls.every(
						(call) =>
							call.searchParams.get("searchCriteria.status") === "all" &&
							withinHistoryWindow(call),
					),
				).toBe(true);
				expect((await list()).data).toHaveLength(380);
				failSecondPage = true;
				expect((await discover("deep")).state).toBe("failed");
				expect(calls).toHaveLength(2);
				expect((await list()).data).toHaveLength(380);
				expect(withinHistoryWindow(calls[0]!)).toBe(true);
				failSecondPage = false;
				expect((await discover("deep")).state).toBe("complete");
				expect(calls).toHaveLength(4);
				const after = await list();
				expect(after.data).toHaveLength(380);
				expect(new Set(after.data.map((pull) => pull.id)).size).toBe(380);
				expect(after.data.find((pull) => pull.number === 379)?.state).toBe(
					"draft",
				);
				mergedFirst = true;
				expect((await discover("deep")).state).toBe("complete");
				expect(calls).toHaveLength(4);
				expect(calls.every(withinHistoryWindow)).toBe(true);
				expect(
					(await list()).data.find((pull) => pull.number === 1)?.state,
				).toBe("merged");
				expect(
					observationListSchema.parse(await cli("watch", "list", "--repo", url))
						.data,
				).toEqual([]);
				await page.goto(
					`/?${new URLSearchParams({ source: "cli", org: "e2e-incremental", draft: "include", q: "Incremental PR 379" })}`,
				);
				await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
				await expect(
					page.getByRole("button", {
						name: "Open PR #379: Incremental PR 379",
					}),
				).toBeVisible();
				await expect(
					page
						.locator("tr[data-pull-id]")
						.getByRole("button", { name: /^Watch PR/ }),
				).toHaveAttribute("aria-pressed", "false");
			} finally {
				markMonitoringDone();
			}
		},
		{ waitForMonitoring: false },
	);
});

test("browsers never drive inference on focus changes or reload", async ({
	browserName,
}, testInfo) => {
	test.skip(
		Boolean(process.env.CI),
		"CDP 焦点/可见性语义在 Linux headless CI 上与本地 Chrome 不一致",
	);
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
		await expect
			.poll(async () => {
				await other.bringToFront();
				return page.evaluate(
					() => document.visibilityState === "hidden" && !document.hasFocus(),
				);
			})
			.toBe(true);
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
