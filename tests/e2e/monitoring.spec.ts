import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { createCollectionClient } from "../../apps/collect/src/workbench/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import { demoWorkspace } from "../../packages/domain/src/demo";
import {
	collectorQuerySchema,
	observationListSchema,
	pullListSchema,
	repoListSchema,
} from "../../packages/domain/src/query";

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
		project: "Beta",
		id: "repository-two",
		name: "beta",
		projectGuid: "project-guid-two",
	},
];
const repoUrl = (r: (typeof repos)[number]) =>
	`https://dev.azure.com/${r.org}/${r.project}/_git/${r.name}`;
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
			const template = demoWorkspace(now).pullRequests[0]!;
			return {
				state: "complete",
				message: "Synthetic provider result",
				pulls: [
					{
						...template,
						...target,
						projectId: options.project.id,
						externalId: String(target.number),
						title: `${target.repository.name} change ${target.number}`,
						draft: target.number === 2,
						state: merged ? "merged" : "open",
						createdAt: now - 86400,
						updatedAt: now - 1,
						observedAt: now,
						checksObservedAt: now,
						mergedAt: merged ? now - 1 : null,
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
	const rows = page.locator("tr[data-pull-id]");
	const ids = [
		await rows.nth(0).getAttribute("data-pull-id"),
		await rows.nth(1).getAttribute("data-pull-id"),
	];
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
		projectKey: "Beta",
		repository: { id: "repository-two", name: "beta" },
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
	await page.locator("tr[data-pull-id]").first().getByRole("checkbox").check();
	await cli("watch", "remove", staleId!);
	await cli("watch", "add", staleId!);
	await page
		.getByRole("button", { name: "Remove from watch list", exact: true })
		.click();
	await expect(page.getByText(/Watch generation changed/)).toBeVisible();
	expect(
		(await watchList()).data.find((w) => w.pullId === staleId)?.generation,
	).toBe(2);
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
	expect(browserErrors).toEqual([]);
	expect(repoListSchema.parse(await cli("repo", "list")).data).toHaveLength(2);
});
