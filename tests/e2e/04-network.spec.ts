import { expect, test } from "@playwright/test";

test("sidebar shows persisted network attempts and a compact stacked series", async ({
	page,
}) => {
	const now = Math.floor(Date.now() / 1000);
	const event = { id: crypto.randomUUID(), kind: "adoChecks", at: now };
	for (let i = 0; i < 2; i++)
		expect(
			(await page.request.post("/api/collector/network", { data: event })).ok(),
		).toBe(true);
	const stats = await (await page.request.get("/api/query/v1/network")).json();
	expect(stats.buckets).toHaveLength(60);
	expect(
		stats.buckets.reduce(
			(n: number, b: { adoChecks: number }) => n + b.adoChecks,
			0,
		),
	).toBeGreaterThanOrEqual(1);
	await page.route("**/api/query/v1/network", (r) =>
		r.fulfill({
			json: {
				asOf: now,
				buckets: Array.from({ length: 60 }, (_, i) => ({
					at: Math.floor(now / 60) * 60 - (59 - i) * 60,
					adoDiscovery: i === 30 ? 2 : 0,
					adoDetails: i === 30 ? 3 : 0,
					adoChecks: i === 30 ? 5 : 0,
					jev: i === 30 ? 1 : 0,
				})),
			},
		}),
	);
	await page.goto("/prs");
	const chart = page.getByRole("region", {
		name: "Provider network requests in the last hour",
	});
	await expect(chart).toContainText("11 requests");
	await expect(chart.locator(".recharts-bar")).toHaveCount(4);
	const fills = await chart
		.locator(".recharts-bar-rectangle path")
		.evaluateAll((elements) => [
			...new Set(elements.map((e) => getComputedStyle(e).fill)),
		]);
	expect(fills).toHaveLength(4);
	const box = (await chart.boundingBox())!;
	expect(box.height).toBeLessThan(135);
	await chart
		.locator(".recharts-surface")
		.hover({ position: { x: box.width / 2, y: 30 } });
	const tooltip = page.locator("body > .recharts-tooltip-wrapper");
	await expect(tooltip).toContainText("Jev");
	const panel = tooltip.locator(".recharts-default-tooltip");
	await expect(panel).toBeVisible();
	const tooltipBox = (await panel.boundingBox())!;
	expect(tooltipBox.x + tooltipBox.width).toBeGreaterThan(box.x + box.width);
	expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(1440);
	expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
	expect(
		await panel.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			const previous = element.style.pointerEvents;
			element.style.pointerEvents = "auto";
			const hit = document.elementFromPoint(bounds.right - 4, bounds.top + 4);
			element.style.pointerEvents = previous;
			return !!hit && element.contains(hit);
		}),
	).toBe(true);
	await page.reload();
	await expect(chart).toContainText("11 requests");
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});
