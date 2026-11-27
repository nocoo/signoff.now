import { expect, test } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import {
	commandReceiptSchema,
	observationListSchema,
	pullListSchema,
} from "../../packages/domain/src/query";
import { DISCOVERY_HISTORY_DAYS } from "../../packages/domain/src/workbench";
import {
	api,
	base,
	cli,
	fakeAdo,
	now,
	silent,
	withWatchLock,
} from "./monitoring-helpers";

test("discovery refreshes full history, retries partial pages and respects manual mode", async ({
	page,
}) => {
	await withWatchLock("exclusive", async () => {
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
		// Discovery always bounds history to the 90-day contribution window.
		const withinHistoryWindow = (request: URL) => {
			const min = request.searchParams.get("searchCriteria.minTime");
			return (
				min !== null &&
				Date.parse(min) >= (now - DISCOVERY_HISTORY_DAYS * 86400 - 60) * 1000
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
		expect(after.data.find((pull) => pull.number === 379)?.state).toBe("draft");
		mergedFirst = true;
		expect((await discover("deep")).state).toBe("complete");
		expect(calls).toHaveLength(4);
		expect(calls.every(withinHistoryWindow)).toBe(true);
		expect((await list()).data.find((pull) => pull.number === 1)?.state).toBe(
			"merged",
		);
		expect(
			observationListSchema.parse(await cli("watch", "list", "--repo", url))
				.data,
		).toEqual([]);
		await page.goto(
			`/?${new URLSearchParams({ source: "cli", org: "e2e-incremental", draft: "include", q: "Incremental PR 379" })}`,
		);
		await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Open PR #379: Incremental PR 379" }),
		).toBeVisible();
		await expect(
			page
				.locator("tr[data-pull-id]")
				.getByRole("button", { name: /^Watch PR/ }),
		).toHaveAttribute("aria-pressed", "false");
	});
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
	).toContainText("evaluated individually in the background");
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
