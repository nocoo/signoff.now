import { expect, test } from "@playwright/test";

test("AI Settings persist masked credentials, replace and clear without classifying PRs", async ({
	page,
}) => {
	await page.goto("/ai-settings");
	const key = page.getByLabel("API key", { exact: true });
	await expect(key).toBeVisible();
	const ai = page.getByRole("button", { name: "AI Settings", exact: true }),
		settings = page.getByRole("button", { name: "Settings", exact: true });
	await expect(ai).toBeVisible();
	expect((await ai.boundingBox())!.y).toBeLessThan(
		(await settings.boundingBox())!.y,
	);
	await key.fill("synthetic-e2e-key");
	await page.getByRole("button", { name: "Save key", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Jev key saved" }),
	).toContainText("Jev key saved");
	await page.reload();
	await expect(
		page.getByText("Configured · ••••••••", { exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Replace API key")).toHaveValue("");
	const metadata = await (await page.request.get("/api/ai/settings")).text();
	expect(metadata).not.toContain("synthetic-e2e-key");
	await page.getByLabel("Replace API key").fill("replacement-e2e-key");
	await page.getByRole("button", { name: "Save key", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Jev key saved" }),
	).toContainText("Jev key saved");
	await page.getByRole("button", { name: "Clear key", exact: true }).click();
	await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
	const testResult = await page.request.post("/api/ai/test");
	expect(testResult.status()).toBe(400);
	await page.reload();
	await expect(page.getByText("Test failed", { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
	await page.screenshot({
		path: test.info().outputPath("ai-settings-mobile.png"),
	});
});
