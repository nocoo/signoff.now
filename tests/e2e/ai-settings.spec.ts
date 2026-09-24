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
	const rules = page.getByLabel("General rules", { exact: true });
	await expect(rules).toHaveValue(
		/Build failure or unsatisfied Comment requirements/,
	);
	await rules.fill(
		"Build failure means Attention. Do not decide rerun versus repair.",
	);
	await page.getByRole("button", { name: "Save rules", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Rules saved" }),
	).toBeVisible();
	await page.reload();
	await expect(rules).toHaveValue(
		"Build failure means Attention. Do not decide rerun versus repair.",
	);
	const available = (await (
		await page.request.get("/api/ai/rules")
	).json()) as { projects: { id: string; name: string }[] };
	const project = available.projects[0];
	if (project) {
		await page.getByRole("combobox", { name: "AI rule scope" }).click();
		await page.getByRole("option", { name: project.name, exact: true }).click();
		await page
			.getByLabel("Project-specific rules", { exact: true })
			.fill("Expired builds require inspection before requesting review.");
		await page.getByRole("button", { name: "Save rules", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: "Rules saved" }),
		).toBeVisible();
		await page.reload();
		await expect(rules).toHaveValue(
			"Build failure means Attention. Do not decide rerun versus repair.",
		);
		await page.getByRole("combobox", { name: "AI rule scope" }).click();
		await page.getByRole("option", { name: project.name, exact: true }).click();
		await expect(
			page.getByLabel("Project-specific rules", { exact: true }),
		).toHaveValue(
			"Expired builds require inspection before requesting review.",
		);
	}
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
