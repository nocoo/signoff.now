import { expect, test } from "@playwright/test";
import {
	fixtureObservation,
	fixtureProject,
	fixturePull,
	publicPull,
	queryFixture,
} from "../../apps/web/src/test/monitoring-fixture";
import { presentReadiness } from "../../packages/domain/src/ai-readiness";

test.use({ hasTouch: true });

test("readiness keeps the previous judgment with compact ETA and accessible update details", async ({
	page,
}) => {
	const now = Math.floor(Date.now() / 1000);
	const previous = {
		kind: "ready" as const,
		model: "jev-1.13.0",
		rubric: "test",
		fingerprint: "previous-evidence",
		evaluatedAt: new Date((now - 300) * 1000).toISOString(),
		confidence: 1,
		probabilities: { ready: 1 },
	};
	let readiness = presentReadiness("pending", null, null, previous);
	const fixture = queryFixture();
	await page.route("**/api/ai/tick", (route) =>
		route.fulfill({ json: { processed: false } }),
	);
	await page.route("**/api/ai/schedule?*", (route) =>
		route.fulfill({
			json: {
				revision: 1,
				cooldownSeconds: 300,

				projects: [
					{
						id: fixtureProject.id,
						name: fixtureProject.name,
						lastStartedAt: now - 180,
						lastCompletedAt: now - 180,
						nextEligibleAt: now + 120,
						lastBatchSize: 1,
						inputTokens: null,
						outputTokens: null,
					},
				],
			},
		}),
	);
	await page.route("**/api/query/v1/repos?*", (route) =>
		route.fulfill({ json: fixture.catalog }),
	);
	await page.route("**/api/query/v1/prs?*", (route) =>
		route.fulfill({
			json: {
				...fixture.pulls,
				data: [
					{
						...publicPull(fixturePull, fixtureProject, fixtureObservation()),
						readiness,
					},
				],
			},
		}),
	);
	await page.goto("/prs");
	const row = page.locator(`[data-pull-id="${fixturePull.id}"]`);
	await expect(row.getByText("Ready", { exact: true })).toBeVisible();
	await expect(
		row.locator(`time[datetime="${previous.evaluatedAt}"]`),
	).toContainText("5 min ago");
	await expect(row.getByText("Pending", { exact: true })).toHaveCount(0);
	const note = row.getByRole("button", { name: /Last result · ~2m/ });
	await note.hover();
	await expect(page.getByRole("tooltip")).toContainText(
		"not been verified against the latest evidence",
	);
	await expect(page.getByRole("tooltip")).toContainText("Earliest Jev request");
	await page.screenshot({
		path: test.info().outputPath("readiness-history-desktop.png"),
	});
	await page.reload();
	await expect(row.getByText("Ready", { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await note.tap();
	await expect(page.getByRole("tooltip")).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.screenshot({
		path: test.info().outputPath("readiness-history-mobile.png"),
	});
	readiness = presentReadiness("error", null, "HTTP 402", previous);
	await page.reload();
	await expect(row.getByText("Ready", { exact: true })).toBeVisible();
	await expect(
		row.getByRole("button", { name: /Last result · failed/ }),
	).toBeAttached();
	readiness = presentReadiness("complete", {
		...previous,
		kind: "review_needed",
	});
	await page.reload();
	await expect(row.getByText("Review Needed", { exact: true })).toBeVisible();
	await expect(row.getByRole("button", { name: /Last result/ })).toHaveCount(0);
	await expect(
		row.getByText("Review Needed", { exact: true }).locator(".."),
	).toHaveClass(/bg-basalt-badge-purple/);
	await page.setViewportSize({ width: 1440, height: 1000 });
	const filter = page.getByRole("button", {
		name: "Review Needed",
		exact: true,
	});
	const filteredRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).searchParams.get("status") === "review_needed",
	);
	await filter.click();
	await filteredRequest;
	await expect(filter).toHaveAttribute("aria-pressed", "true");
	await page.reload();
	await expect(filter).toHaveAttribute("aria-pressed", "true");
	await expect(row.getByText("Review Needed", { exact: true })).toBeVisible();
});

test("compact sortable columns preserve full branches and cyan Skipped across reloads", async ({
	page,
}) => {
	const fixture = queryFixture();
	const branch =
		"users/example/integration/a-long-target-branch-with-full-identity";
	await page.route("**/api/ai/tick", (route) =>
		route.fulfill({ json: { processed: false } }),
	);
	await page.route("**/api/query/v1/repos?*", (route) =>
		route.fulfill({ json: fixture.catalog }),
	);
	await page.route("**/api/query/v1/prs?*", (route) =>
		route.fulfill({
			json: {
				...fixture.pulls,
				metrics: { ...fixture.pulls.metrics, skipped: 1 },
				data: [
					{
						...publicPull(fixturePull, fixtureProject, fixtureObservation()),
						targetBranch: branch,
						readiness: {
							...presentReadiness("complete"),
							kind: "skipped",
							label: "Skipped",
							nextAction: "Non-main target branch; Jev evaluation skipped.",
						},
					},
				],
			},
		}),
	);
	await page.setViewportSize({ width: 3840, height: 1080 });
	await page.goto("/prs");
	const row = page.locator(`[data-pull-id="${fixturePull.id}"]`);
	await expect(
		row.getByText("Skipped", { exact: true }).locator(".."),
	).toHaveClass(/bg-basalt-badge-teal/);
	expect(
		await row
			.getByRole("button", { name: /^Open PR/ })
			.evaluate((element) => getComputedStyle(element).fontSize),
	).toBe("12px");
	expect(
		await row
			.getByText(branch, { exact: true })
			.evaluate((element) => getComputedStyle(element).fontSize),
	).toBe("11px");
	await expect(row.getByText(branch, { exact: true })).toBeVisible();
	await expect(
		page.getByRole("columnheader", { name: "Sort by Target branch" }),
	).toHaveCount(0);
	const lifecycle = row.locator('[title="Provider PR lifecycle"]');
	await expect(lifecycle).toHaveText("Open");
	await expect(lifecycle).toHaveClass(/bg-basalt-heatmap-green/);
	expect(
		await row
			.getByText(branch, { exact: true })
			.evaluate((element) =>
				element.closest("a")?.previousElementSibling?.getAttribute("title"),
			),
	).toBe("Provider PR lifecycle");
	expect(
		await row
			.getByText(branch, { exact: true })
			.evaluate((element) => getComputedStyle(element).whiteSpace),
	).toBe("nowrap");
	expect(
		await row
			.locator("td")
			.evaluateAll((cells) =>
				cells.every((cell) => getComputedStyle(cell).whiteSpace === "nowrap"),
			),
	).toBe(true);
	await expect(row.getByText(branch, { exact: true })).not.toHaveClass(
		/truncate/,
	);
	await expect(
		row.getByRole("button", { name: /Last result|Jev ·/ }),
	).toHaveCount(0);
	await expect(page.getByRole("columnheader")).toHaveCount(12);
	for (const [label, key] of [
		["Repository", "repository"],
		["Author", "author"],
		["State checked", "stateChecked"],
		["Checks collected", "checksChecked"],
		["Jev evaluated", "evaluated"],
	]) {
		const sortedRequest = page.waitForRequest(
			(request) =>
				request.url().includes("/api/query/v1/prs?") &&
				new URL(request.url()).searchParams.get("sort") === key,
		);
		await page
			.getByRole("button", { name: `Sort by ${label}`, exact: true })
			.click();
		await sortedRequest;
		await expect(
			page.getByRole("table", { name: "Pull requests" }),
		).toHaveAttribute("aria-busy", "false");
	}
	await page.screenshot({
		path: test.info().outputPath("compact-pr-list-desktop.png"),
	});
	await page.reload();
	await expect(row.getByText("Skipped", { exact: true })).toBeVisible();
	const authorHeader = page.getByRole("button", {
		name: "Sort by Author",
		exact: true,
	});
	const repositoryHeader = page.getByRole("button", {
		name: "Sort by Repository",
		exact: true,
	});
	const table = page.getByRole("table", { name: "Pull requests" });
	await page.evaluate(() => document.fonts.ready);
	const repositoryWidth = (await row.locator("td").nth(3).boundingBox())!.width;
	const authorWidth = (await row.locator("td").nth(4).boundingBox())!.width;
	await page.setViewportSize({ width: 1920, height: 1080 });
	await expect(authorHeader).toBeHidden();
	await expect(repositoryHeader).toBeHidden();
	await page.reload();
	await expect(row).toBeVisible();
	await expect(authorHeader).toBeHidden();
	await expect(repositoryHeader).toBeHidden();
	await expect(row.locator("td").nth(3)).toBeHidden();
	await expect(row.locator("td").nth(4)).toBeHidden();
	const dimensions = await table.evaluate((element) => ({
		required: element.scrollWidth,
		available: element.parentElement!.clientWidth,
	}));
	expect(dimensions.required).toBeGreaterThan(dimensions.available);
	const middleWidth = Math.ceil(
		dimensions.required +
			repositoryWidth +
			authorWidth / 2 +
			1920 -
			dimensions.available,
	);
	await page.setViewportSize({ width: middleWidth, height: 1080 });
	await expect(authorHeader).toBeHidden();
	await expect(repositoryHeader).toBeVisible();
	expect(
		await table.evaluate(
			(element) =>
				element.scrollWidth <= element.parentElement!.clientWidth + 1,
		),
	).toBe(true);
	await page
		.getByRole("button", { name: "Collapse sidebar", exact: true })
		.click();
	await expect(authorHeader).toBeVisible();
	await expect(repositoryHeader).toBeVisible();
	await page.setViewportSize({ width: 3840, height: 1080 });
	await expect(authorHeader).toBeVisible();
	await expect(repositoryHeader).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(authorHeader).toBeHidden();
	await expect(repositoryHeader).toBeHidden();
	await row.getByText(branch, { exact: true }).scrollIntoViewIfNeeded();
	await expect(row.getByText(branch, { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.screenshot({
		path: test.info().outputPath("compact-pr-list-mobile.png"),
	});
});
