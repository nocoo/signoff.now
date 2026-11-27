import { expect, test } from "@playwright/test";
import {
	commandReceiptSchema,
	pullDetailSchema,
} from "../../packages/domain/src/query";
import {
	base,
	cli,
	execute,
	getProviderRequests,
	repos,
	repoUrl,
	watchList,
	withWatchLock,
} from "./monitoring-helpers";

test("friendly workspace URLs survive history, reload and sharing without changing rule scope", async ({
	page,
	browser,
}) => {
	await withWatchLock("shared", async () => {
		const repo = {
			org: "e2e-urls",
			project: "URL space",
			id: "url-repository",
			name: "routes + 100%",
			projectGuid: "url-project",
		};
		repos.push(repo);
		await cli("repo", "add", repoUrl(repo));
		const scopePath = `ado/${repo.org}/${encodeURIComponent(repo.project)}`;
		const repositoryPath = `${scopePath}/${encodeURIComponent(repo.name)}`;
		await page.goto(`/sm/${repositoryPath}`);
		await expect(page.getByRole("alert")).toContainText(
			"Repository address is not collected",
		);
		await expect(
			page.getByRole("region", { name: "State machine graph" }),
		).toHaveCount(0);
		await expect
			.poll(() => new URL(page.url()).pathname)
			.toBe(`/sm/${repositoryPath}`);
		const discovery = commandReceiptSchema.parse(
			await cli("discover", "--repo", repoUrl(repo)),
		);
		expect((await execute(false, discovery.jobs[0]!.id)).state).toBe(
			"complete",
		);
		await cli("watch", "add", `${repoUrl(repo)}/pullrequest/1`);
		try {
			const pull = pullDetailSchema.parse(
				await cli("pr", "get", `${repoUrl(repo)}/pullrequest/1`),
			).data;
			const providerReads = getProviderRequests();
			const watches = await watchList("--org", repo.org);
			const detailPath = `/prs/${repositoryPath}/1`;
			await page.goto(`/prs?source=live&org=${repo.org}`);
			await page
				.getByRole("combobox", { name: "Project", exact: true })
				.click();
			await page
				.getByRole("option", { name: repo.project, exact: true })
				.click();
			await page
				.getByRole("combobox", { name: "Repository", exact: true })
				.click();
			await page.getByRole("option", { name: repo.name, exact: true }).click();
			await page.getByRole("textbox", { name: "Search PRs" }).fill("change");
			await page.getByRole("combobox", { name: "Draft", exact: true }).click();
			await page
				.getByRole("option", { name: "Include drafts", exact: true })
				.click();
			await page.getByRole("button", { name: "Watched", exact: true }).click();
			await page
				.getByRole("button", { name: "All states", exact: true })
				.click();
			const sort = page.getByRole("button", {
				name: "Sort by Pull request",
				exact: true,
			});
			await sort.click();
			await sort.click();
			const preferencesUrl = new URL(page.url());
			preferencesUrl.searchParams.sort();
			const storedPreferences = () =>
				page.evaluate(() => localStorage.getItem("signoff-pull-filters"));
			const preferences = await storedPreferences();
			expect(Object.fromEntries(new URLSearchParams(preferences!))).toEqual({
				source: "live",
				org: repo.org,
				project: pull.project.id,
				repo: repo.id,
				q: "change",
				draft: "include",
				watching: "watching",
				state: "all",
				sort: "title",
				direction: "desc",
			});
			const expectPreferences = async () => {
				await expect(page).toHaveURL((url) => {
					url.searchParams.sort();
					return url.href === preferencesUrl.href;
				});
				await expect(
					page.getByRole("textbox", { name: "Search PRs" }),
				).toHaveValue("change");
				await expect(
					page.getByRole("combobox", { name: "Repository", exact: true }),
				).toHaveText(repo.name);
				await expect(
					page.getByRole("combobox", { name: "Draft", exact: true }),
				).toHaveText("Include drafts");
				await expect(
					page.getByRole("button", { name: "Watched", exact: true }),
				).toHaveAttribute("aria-pressed", "true");
				await expect(
					page.getByRole("button", { name: "All states", exact: true }),
				).toHaveAttribute("aria-pressed", "true");
				await expect(
					page.getByRole("columnheader", {
						name: "Sort by Pull request",
						exact: true,
					}),
				).toHaveAttribute("aria-sort", "descending");
				await expect(page.locator("tr[data-pull-id]")).toHaveCount(1);
			};
			await page.reload();
			await expectPreferences();
			await page.goto("/prs");
			await expectPreferences();
			await page.goto(`/sm/${repositoryPath}?pr=1`);
			await expect(
				page.getByRole("combobox", { name: "State machine repository" }),
			).toHaveText(repo.name);
			expect(await storedPreferences()).toBe(preferences);
			await page
				.getByRole("button", { name: "Pull requests", exact: true })
				.click();
			await expectPreferences();
			let documents = 0;
			page.on("request", (request) => {
				if (request.resourceType() === "document") documents++;
			});
			await page.goto(`/?pr=${encodeURIComponent(pull.id)}`);
			await expect(
				page.getByRole("heading", { name: pull.title, exact: true }),
			).toBeVisible();
			await expect(page).toHaveURL(`${base}${detailPath}`);
			const loadedDocuments = documents;
			await page
				.getByRole("button", { name: "Close pull request details" })
				.click();
			await expect(page).toHaveURL(`${base}/prs?source=live`);
			await page.goBack();
			await expect(
				page.getByRole("heading", { name: pull.title, exact: true }),
			).toBeVisible();
			await expect(page).toHaveURL(`${base}${detailPath}`);
			await page.goForward();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			expect(documents).toBe(loadedDocuments);
			await page.goBack();
			await page.reload();
			await expect(
				page.getByRole("heading", { name: pull.title, exact: true }),
			).toBeVisible();
			await expect(page).toHaveURL(`${base}${detailPath}`);

			await page.goto(`/sm/${scopePath}`);
			const repository = page.getByRole("combobox", {
				name: "State machine repository",
			});
			await expect(repository).toHaveText("Project default");
			await repository.click();
			await page.getByRole("option", { name: repo.name, exact: true }).click();
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toBe(`/sm/${repositoryPath}`);
			await page.reload();
			await expect(repository).toHaveText(repo.name);
			const fresh = await browser.newContext();
			try {
				const shared = await fresh.newPage();
				await shared.goto(`${base}/sm/${repositoryPath}`);
				await expect(
					shared.getByRole("combobox", { name: "State machine repository" }),
				).toHaveText(repo.name);
			} finally {
				await fresh.close();
			}

			expect(getProviderRequests()).toBe(providerReads);
			const after = await watchList("--org", repo.org);
			// Daemon inference can publish a new readiness revision without changing watch membership.
			expect(after.data.map(({ pull: _pull, ...watch }) => watch)).toEqual(
				watches.data.map(({ pull: _pull, ...watch }) => watch),
			);
		} finally {
			await cli("watch", "remove", `${repoUrl(repo)}/pullrequest/1`);
		}
	});
});
