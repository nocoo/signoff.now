import { expect, test } from "@playwright/test";
import {
	fixturePull,
	localSession,
	queryFixture,
} from "../../apps/web/src/test/monitoring-fixture";

test("a service outage shows one alert, preserves cached PRs and recovers on retry", async ({
	page,
}) => {
	const fixture = queryFixture();
	let unavailable = false;
	await page.route("**/api/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/api/me") return route.fulfill({ json: localSession });
		if (unavailable) return route.fulfill({ status: 502, body: "Bad Gateway" });
		const responses: Record<string, unknown> = {
			"/api/query/v1/repos": fixture.catalog,
			"/api/query/v1/prs": fixture.pulls,
			"/api/query/v1/collector": fixture.collector,
			"/api/query/v1/observations": {
				...fixture.envelope,
				schemaVersion: 2,
				data: [],
				page: { ...fixture.page, total: 0 },
			},
		};
		const data = responses[path];
		if (data) return route.fulfill({ json: data });
		return route.continue();
	});
	await page.goto("/prs?watching=watching");
	const row = page.locator(`[data-pull-id="${fixturePull.id}"]`);
	await expect(row).toBeVisible();
	unavailable = true;
	await page.evaluate(() =>
		document.dispatchEvent(new Event("visibilitychange")),
	);
	const alert = page.getByRole("alert");
	await expect(alert).toHaveCount(1);
	await expect(alert).toContainText("Cannot reach the SignOff service.");
	await expect(alert).toContainText("Showing the last loaded PR data.");
	await expect(row).toBeVisible();
	await page.reload();
	await expect(alert).toHaveCount(1);
	await expect(alert).toContainText("PR data has not loaded yet.");
	await expect(
		page.getByText("Unable to load pull requests", { exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByText(/Repository filters could not refresh/),
	).toHaveCount(0);
	await expect(
		page.getByRole("region", { name: "Pending watches" }),
	).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole("button", { name: "Retry connection" }),
	).toBeVisible();
	unavailable = false;
	await page.getByRole("button", { name: "Retry connection" }).click();
	await expect(row).toBeVisible();
	await expect(alert).toHaveCount(0);
});
