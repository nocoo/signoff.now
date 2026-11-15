import { expect, test } from "@playwright/test";
import {
	localSession,
	queryFixture,
} from "../../apps/web/src/test/monitoring-fixture";

test.beforeEach(async ({ page }) => {
	const fixture = queryFixture();
	await page.route("**/api/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const responses: Record<string, unknown> = {
			"/api/me": localSession,
			"/api/query/v1/repos": fixture.catalog,
			"/api/query/v1/prs": fixture.pulls,
			"/api/query/v1/collector": fixture.collector,
		};
		return route.fulfill({ json: responses[path] ?? {} });
	});
});

test("the sidebar avatar keeps its position when the rail collapses", async ({
	page,
}) => {
	await page.goto("/prs?source=live");
	const avatar = page.getByRole("img", { name: "SignOff user" });
	await expect(avatar).toBeVisible();
	const expanded = await avatar.boundingBox();
	expect(expanded).toBeTruthy();

	await page.getByRole("button", { name: "Collapse sidebar" }).click();
	await expect(
		page.getByRole("button", { name: "Expand sidebar" }),
	).toBeVisible();
	const collapsed = await page
		.getByRole("img", { name: "SignOff user" })
		.boundingBox();
	expect(collapsed).toBeTruthy();

	expect(
		Math.abs((collapsed?.y ?? 0) - (expanded?.y ?? 0)),
	).toBeLessThanOrEqual(1);
	expect(collapsed?.width).toBe(expanded?.width);
	expect(collapsed?.height).toBe(expanded?.height);
});
