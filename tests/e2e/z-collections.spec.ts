import { expect, test } from "@playwright/test";
import { commandReceiptSchema } from "../../packages/domain/src/query";
import {
	cli,
	execute,
	getProviderRequests,
	repos,
	repoUrl,
	watchList,
	withWatchLock,
} from "./monitoring-helpers";

test("collections persist all PR states, multiple memberships and compact CRUD flows", async ({
	page,
}) => {
	test.setTimeout(120000);
	await withWatchLock("shared", async () => {
		const repo = {
			org: "e2e-collections",
			project: "Collection space",
			id: "collection-repository",
			name: "collection-flow",
			projectGuid: "collection-project",
		};
		repos.push(repo);
		await cli("repo", "add", repoUrl(repo));
		const discovery = commandReceiptSchema.parse(
			await cli("discover", "--repo", repoUrl(repo)),
		);
		expect((await execute(false, discovery.jobs[0]!.id)).state).toBe(
			"complete",
		);
		const providerReads = getProviderRequests();
		const beforeWatches = (await watchList("--org", repo.org)).data.map(
			({ pull: _pull, ...watch }) => watch,
		);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/collections?source=live");
			await expect(
				page.getByRole("button", { name: "Collections", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "New collection", exact: true })
				.first()
				.click();
			await page
				.getByLabel("Collection name", { exact: true })
				.fill("Release quality");
			await page
				.getByLabel("Collection purpose")
				.fill("Track the complete testing effort.");
			await page.getByRole("button", { name: "flask icon" }).click();
			await page.getByRole("button", { name: "teal color" }).click();
			await page
				.getByRole("button", { name: "Create collection", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: "Release quality", exact: true }),
			).toBeVisible();
			const collectionUrl = page.url();
			const collectionId = new URL(collectionUrl).pathname.split("/").at(-1)!;
			await page
				.getByRole("button", { name: "Add PRs", exact: true })
				.first()
				.click();
			await page.getByLabel("Find PRs to add").fill("collection-flow change");
			await expect(
				page.getByText("0 selected · 26 matching PRs", { exact: true }),
			).toBeVisible();
			const candidates = page.getByRole("region", { name: "PR candidates" });
			await expect(candidates.getByRole("checkbox").first()).toBeEnabled();
			for (const checkbox of await candidates.getByRole("checkbox").all())
				await checkbox.check();
			await page.getByRole("button", { name: "Next candidate page" }).click();
			await expect(candidates.getByRole("checkbox")).toHaveCount(6);
			await expect(candidates.getByRole("checkbox").first()).toBeEnabled();
			for (const checkbox of await candidates.getByRole("checkbox").all())
				await checkbox.check();
			await page
				.getByRole("button", { name: "Add 26 PRs", exact: true })
				.click();
			const rows = page.locator("tr[data-pull-id]");
			await expect(rows).toHaveCount(26);
			await expect(
				page.getByRole("button", { name: "Next page", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("img", {
					name: "1 merged, 23 open, 1 draft, 1 closed out of 26",
				}),
			).toBeVisible();
			await page.reload();
			await expect(rows).toHaveCount(26);
			const filters = page.getByRole("region", { name: "PR filters" });
			await filters.getByRole("button", { name: "Draft", exact: true }).click();
			await expect(rows).toHaveCount(1);
			await page.reload();
			await expect(
				filters.getByRole("button", { name: "Draft", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(rows).toHaveCount(1);
			await filters.getByRole("button", { name: "Open", exact: true }).click();
			await expect(rows).toHaveCount(23);
			await expect(
				filters.getByRole("button", { name: "Draft", exact: true }),
			).toContainText("1");
			for (const state of ["Merged", "Closed"]) {
				await filters.getByRole("button", { name: state, exact: true }).click();
				await expect(rows).toHaveCount(1);
			}
			await filters
				.getByRole("button", { name: "All states", exact: true })
				.click();
			await expect(rows).toHaveCount(26);
			await page
				.getByRole("button", { name: "Edit collection", exact: true })
				.click();
			await page
				.getByLabel("Collection name", { exact: true })
				.fill("Release quality updated");
			await page
				.getByRole("button", { name: "Save changes", exact: true })
				.click();
			await expect(
				page.getByRole("heading", {
					name: "Release quality updated",
					exact: true,
				}),
			).toBeVisible();
			await page.setViewportSize({ width: 390, height: 844 });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth,
				),
			).toBe(false);
			await page.screenshot({
				path: test.info().outputPath("collections-mobile.png"),
			});
			await page.setViewportSize({ width: 1440, height: 1000 });
			const second = await (
				await page.request.post("/api/pr-collections", {
					data: {
						name: "Also tracked",
						description: "Secondary purpose",
						icon: "flag",
						color: "amber",
					},
				})
			).json();
			await page.goto(
				`/prs?source=live&org=${repo.org}&draft=include&state=all`,
			);
			const membershipMarker = page.getByRole("button", {
				name: "Collections for PR #1",
				exact: true,
			});
			await membershipMarker.hover();
			await expect(page.getByRole("tooltip")).toContainText(
				"Release quality updated",
			);
			await membershipMarker.click();
			await page
				.getByRole("checkbox", { name: "Also tracked", exact: true })
				.click();
			await expect(
				page.getByRole("checkbox", { name: "Also tracked", exact: true }),
			).toBeChecked();
			await page.getByRole("button", { name: "Done", exact: true }).click();
			await page.reload();
			await expect(membershipMarker).toContainText("2");
			await membershipMarker.hover();
			await expect(page.getByRole("tooltip")).toContainText("Also tracked");
			await expect(page.getByRole("tooltip")).toContainText(
				"Release quality updated",
			);
			await page.goto(collectionUrl);
			const memberTable = page.getByRole("table", {
				name: "Collection pull requests",
			});
			await expect(memberTable).toHaveAttribute("aria-busy", "false");
			const watchButton = memberTable.getByRole("button", {
				name: "Watch PR #1 in Collection space/collection-flow",
				exact: true,
			});
			await watchButton.click();
			await expect(watchButton).toHaveAttribute("aria-pressed", "true");
			await expect(watchButton).toBeEnabled();
			await page.reload();
			await expect(watchButton).toHaveAttribute("aria-pressed", "true");
			await watchButton.click();
			await expect(watchButton).toHaveAttribute("aria-pressed", "false");
			await expect(watchButton).toBeEnabled();
			const sortTitle = memberTable.getByRole("button", {
				name: "Sort by Pull request",
				exact: true,
			});
			await sortTitle.click();
			await expect(
				memberTable.getByRole("columnheader", {
					name: "Sort by Pull request",
					exact: true,
				}),
			).toHaveAttribute("aria-sort", "ascending");
			await filters.getByRole("button", { name: "Draft", exact: true }).click();
			await page.reload();
			await expect(rows).toHaveCount(1);
			await expect(
				memberTable.getByRole("columnheader", {
					name: "Sort by Pull request",
					exact: true,
				}),
			).toHaveAttribute("aria-sort", "ascending");
			await page.goto(`/collections/${second.id}?source=live`);
			await expect(
				filters.getByRole("button", { name: "All states", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(
				memberTable.getByRole("columnheader", {
					name: "Sort by PR updated",
					exact: true,
				}),
			).toHaveAttribute("aria-sort", "descending");
			await filters
				.getByRole("button", { name: "Closed", exact: true })
				.click();
			await memberTable
				.getByRole("button", { name: "Sort by Readiness", exact: true })
				.click();
			await page.reload();
			await expect(
				filters.getByRole("button", { name: "Closed", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(
				memberTable.getByRole("columnheader", {
					name: "Sort by Readiness",
					exact: true,
				}),
			).toHaveAttribute("aria-sort", "ascending");
			await page.goto(collectionUrl);
			await expect(
				filters.getByRole("button", { name: "Draft", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(rows).toHaveCount(1);
			await expect(
				memberTable.getByRole("columnheader", {
					name: "Sort by Pull request",
					exact: true,
				}),
			).toHaveAttribute("aria-sort", "ascending");
			await filters
				.getByRole("button", { name: "All states", exact: true })
				.click();
			await expect(rows).toHaveCount(26);

			await expect(
				memberTable.locator("tbody tr[data-pull-id]").first(),
			).toHaveClass(/h-16/);
			await page
				.getByRole("button", {
					name: "Remove PR #1 from collection",
					exact: true,
				})
				.click();
			await expect(
				page.getByRole("img", {
					name: "1 merged, 22 open, 1 draft, 1 closed out of 25",
				}),
			).toBeVisible();
			await memberTable
				.getByRole("checkbox", { name: "Select all collection PRs" })
				.check();
			await expect(
				memberTable.getByRole("checkbox", { checked: true }),
			).toHaveCount(26);
			await page
				.getByRole("button", { name: "Add to watch list", exact: true })
				.click();
			await expect(
				memberTable.locator(
					'button[aria-label^="Watch PR"][aria-pressed="true"]',
				),
			).toHaveCount(23);
			await expect(
				page.getByRole("button", {
					name: "Remove from collection",
					exact: true,
				}),
			).toBeEnabled();
			const watchesAfterBulk = (await watchList("--org", repo.org)).data.map(
				({ pull: _pull, ...watch }) => watch,
			);
			expect(watchesAfterBulk).toEqual(expect.arrayContaining(beforeWatches));
			expect(watchesAfterBulk.length).toBe(beforeWatches.length + 23);

			await page
				.getByRole("button", { name: "Remove from collection", exact: true })
				.click();
			await expect(rows).toHaveCount(0);
			await page.reload();
			await expect(rows).toHaveCount(0);
			await expect(
				page.getByText("Your collection is ready", { exact: true }),
			).toBeVisible();

			await page
				.getByRole("button", { name: "Delete collection", exact: true })
				.click();
			await page
				.getByRole("alertdialog")
				.getByRole("button", { name: "Delete collection", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: "Collections", exact: true }),
			).toBeVisible();
			expect(
				(
					await page.request.get(`/api/pr-collections/${collectionId}`)
				).status(),
			).toBe(404);
			const remaining = await (
				await page.request.get(`/api/pr-collections/${second.id}`)
			).json();
			expect(remaining.counts.total).toBe(1);
			await page.goto("/collections?source=sample");
			await expect(
				page.getByRole("heading", { name: "Collections", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("link").filter({ hasText: "Also tracked" }),
			).toHaveCount(0);
			expect(getProviderRequests()).toBe(providerReads);
			expect(
				(await watchList("--org", repo.org)).data.map(
					({ pull: _pull, ...watch }) => watch,
				),
			).toEqual(watchesAfterBulk);
			expect(errors).toEqual([]);
		} finally {
			const orgWatches = await watchList("--org", repo.org);
			const ids = orgWatches.data
				.map((item) => item.pr.id)
				.filter((id): id is string => Boolean(id));
			if (ids.length > 0) {
				await cli("watch", "remove", ...ids);
			}
		}
	});
});
