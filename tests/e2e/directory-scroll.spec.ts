import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	localSession,
	queryFixture,
} from "../../apps/web/src/test/monitoring-fixture";
import type { DirectoryData } from "../../packages/domain/src/insights";

const entries = Array.from({ length: 40 }, (_, index) => ({
	id: `entry-${index}`,
	name: `Person ${String(index).padStart(2, "0")}`,
	avatarUrl: null,
	archivedAt: null,
}));
const directory: DirectoryData = {
	source: "cli",
	revision: 1,
	projects: [],
	repositories: [],
	blockedContributorKeys: [],
	members: entries.map((entry) => ({
		...entry,
		identityKeys: [],
		teamIds: ["core"],
		tagIds: [],
	})),
	teams: [
		{
			id: "core",
			name: "Core",
			avatarUrl: null,
			archivedAt: null,
			memberIds: entries.slice(0, 20).map((entry) => entry.id),
			tagIds: [],
		},
		...entries.map((entry) => ({ ...entry, memberIds: [], tagIds: [] })),
	],
	tags: entries.map((entry) => ({ ...entry, color: "#336699" })),
	identities: entries.map((entry) => ({
		key: entry.id,
		provider: "ado",
		organization: "example",
		actorId: entry.id,
		name: entry.name,
		handle: entry.id,
		avatarUrl: null,
		memberId: null,
		lastSeenAt: 1,
	})),
};

test.beforeEach(async ({ page }) => {
	const fixture = queryFixture();
	await page.route("**/api/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const responses: Record<string, unknown> = {
			"/api/me": localSession,
			"/api/directory": directory,
			"/api/query/v1/repos": fixture.catalog,
			"/api/query/v1/prs": fixture.pulls,
			"/api/query/v1/collector": fixture.collector,
		};
		return route.fulfill({ json: responses[path] ?? {} });
	});
});

async function scrollList(page: Page, list: Locator) {
	await expect(list).toBeVisible();
	await expect
		.poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight))
		.toBeGreaterThan(0);
	await list.hover();
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => list.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(0);
}

for (const picker of [
	{ path: "/teams", action: "Add members to Core", label: "Members to add" },
	{ path: "/teams", action: "Edit Core", label: "Members" },
	{ path: "/teams", action: "Edit Core", label: "Tags" },
	{ path: "/developers", action: "Add member", label: "Linked accounts" },
	{ path: "/developers", action: "Add member", label: "Teams" },
	{ path: "/developers", action: "Add member", label: "Tags" },
]) {
	test(`${picker.action}: ${picker.label} scrolls and preserves modal focus`, async ({
		page,
	}) => {
		await page.goto(`${picker.path}?source=live`);
		await page
			.getByRole("button", { name: picker.action, exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		const trigger = dialog.getByRole("button", {
			name: picker.label,
			exact: true,
		});
		await trigger.click();
		const list = page.getByRole("listbox", { name: picker.label, exact: true });
		await scrollList(page, list);
		const search = page.getByRole("combobox", {
			name: `${picker.label}: search`,
		});
		await expect(search).toBeFocused();
		await search.fill("Person 39");
		await search.press("ArrowDown");
		await search.press("Enter");
		await expect(list.getByRole("option")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await search.press("Escape");
		await expect(list).toHaveCount(0);
		await expect(dialog).toBeVisible();
		await expect(trigger).toBeFocused();
		await expect(page.locator("body")).toHaveAttribute(
			"data-scroll-locked",
			"1",
		);
		const background = page.locator("main [data-basalt-surface-root]");
		const backgroundTop = await background.evaluate((node) => node.scrollTop);
		await page.mouse.move(1400, 500);
		await page.mouse.wheel(0, 400);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}),
		);
		await expect(background).toHaveJSProperty("scrollTop", backgroundTop);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(dialog).toHaveCount(0);
	});
}

test("team card lists and nonmodal filters scroll", async ({ page }) => {
	await page.goto("/teams?source=live");
	await scrollList(page, page.getByRole("list", { name: "Core members" }));
	await page.goto("/insights?source=live");
	await page
		.getByRole("button", { name: "Members & authors", exact: true })
		.click();
	await scrollList(
		page,
		page.getByRole("listbox", { name: "Members & authors", exact: true }),
	);
	await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
});

test("member picker supports touch scrolling on a narrow screen", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 640 });
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	await page.goto("/teams?source=live");
	await page
		.getByRole("button", { name: "Add members to Core", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Members to add", exact: true })
		.click();
	const list = page.getByRole("listbox", {
		name: "Members to add",
		exact: true,
	});
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.y + box!.height).toBeLessThanOrEqual(640);
	const x = box!.x + box!.width / 2;
	const y = box!.y + box!.height - 20;
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ x, y }],
	});
	for (let distance = 20; distance <= 160; distance += 20) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x, y: y - distance }],
		});
	}
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await expect
		.poll(() => list.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(0);
	await cdp.detach();
});
