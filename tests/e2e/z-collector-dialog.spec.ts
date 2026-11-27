import { expect, test } from "@playwright/test";

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
