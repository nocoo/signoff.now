import { expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import {
	batchCommandSchema,
	commandReceiptSchema,
	machinePageSchema,
	observationListSchema,
	pullDetailSchema,
	pullListSchema,
	repoListSchema,
} from "../../packages/domain/src/query";
import { projectSchema } from "../../packages/domain/src/workbench";
import {
	api,
	base,
	cli,
	execute,
	fakeAdo,
	now,
	repos,
	repoUrl,
	silent,
	withWatchLock,
} from "./monitoring-helpers";

test("policy instructions persist with priority, scope and cached Jev errors", async ({
	page,
}) => {
	await withWatchLock("shared", async () => {
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
		expect((await execute(false, discovery.jobs[0]!.id)).state).toBe(
			"complete",
		);
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

		try {
			const machineUrl = `${base}/api/state-machines/${projectId}?source=live&repositoryId=${repo.id}`;
			await page.goto(
				`/policy-instructions/ado/${repo.org}/${repo.project}/${repo.name}`,
			);
			const area = page
				.getByRole("listitem")
				.filter({
					has: page.getByRole("heading", {
						name: /Required reviewer approvals$/,
					}),
				})
				.getByRole("textbox", {
					name: "Meaning and human action instructions",
				});
			await area.fill(
				"A person should approve this gate after checking the provider evidence.",
			);
			await page
				.getByRole("button", { name: "Save policy instructions", exact: true })
				.click();
			await expect(
				page
					.getByRole("status")
					.filter({ hasText: "Policy instructions saved" }),
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
			await expect(
				page.getByText("Error", { exact: true }).first(),
			).toBeVisible();
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
				page
					.getByRole("status")
					.filter({ hasText: "Policy instructions saved" }),
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
			await page
				.getByRole("button", { name: "Transitions", exact: true })
				.click();
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
		} finally {
			await cli("watch", "remove", pull.id);
		}
	});
});

test("repository IDs remain scoped across cold discovery, mixed watch batches, CLI and browser filters", async ({
	page,
}) => {
	await withWatchLock("shared", async () => {
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
				const externalProject = {
					id: "identity-project-guid",
					name: "Identity",
				};
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
				const repo = repositories.find((r) =>
					url.pathname.includes(`/${r.id}/`),
				);
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
		// Project discovery queues one task per repository plus a catalogue task
		// that fans out children; run the receipt and everything it queued.
		const executeDiscovery = async (receipt: unknown) => {
			commandReceiptSchema.parse(receipt);
			let ran = 0;
			for (
				let run = await runCollectionOnce({
					api,
					makeAdo: () => provider,
					log: silent,
				});
				run.processed;
				run = await runCollectionOnce({
					api,
					makeAdo: () => provider,
					log: silent,
				})
			) {
				expect(run.state).toBe("complete");
				ran++;
			}
			expect(ran).toBeGreaterThan(0);
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
		await page
			.getByRole("button", { name: "Discover PRs", exact: true })
			.click();
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
			).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
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
			page.getByText("1 PR removed from the shared watch list.", {
				exact: true,
			}),
		).toBeVisible();
		expect(
			observationListSchema.parse(
				await cli("watch", "list", "--org", organization),
			).data,
		).toEqual([]);
		expect(requests).toBe(beforeQueries);
	});
});
