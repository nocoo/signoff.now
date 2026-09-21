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
				foreground: true,
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
	readiness = presentReadiness("complete", { ...previous, kind: "attention" });
	await page.reload();
	await expect(row.getByText("Attention", { exact: true })).toBeVisible();
	await expect(row.getByRole("button", { name: /Last result/ })).toHaveCount(0);
});
