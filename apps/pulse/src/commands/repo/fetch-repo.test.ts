import { describe, expect, test } from "bun:test";
import { MockGitHubClient } from "../../api/mock-client.ts";
import type { RepositoryInfo } from "../types.ts";
import { fetchRepo } from "./fetch-repo.ts";

function makeRepoInfo(overrides?: Partial<RepositoryInfo>): RepositoryInfo {
	return {
		owner: "acme",
		name: "repo",
		url: "https://github.com/acme/repo",
		description: "A cool project",
		homepageUrl: "https://acme.dev",
		stargazerCount: 1234,
		forkCount: 56,
		isArchived: false,
		isPrivate: false,
		primaryLanguage: { name: "TypeScript", color: "#3178c6" },
		languages: [
			{ name: "TypeScript", color: "#3178c6" },
			{ name: "JavaScript", color: "#f1e05a" },
		],
		defaultBranchRef: "main",
		licenseInfo: "MIT",
		topics: ["cli", "typescript"],
		pushedAt: "2025-01-15T10:00:00Z",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2025-01-15T09:00:00Z",
		...overrides,
	};
}

describe("fetchRepo", () => {
	test("assembles repository report from API result", async () => {
		const repoInfo = makeRepoInfo();
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			undefined,
			{ repository: repoInfo },
		);

		const report = await fetchRepo(client, {
			owner: "acme",
			repo: "repo",
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.repository).toEqual(repoInfo);
		expect(report.generatedAt).toBeTruthy();
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("records fetch repository call", async () => {
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			undefined,
			{ repository: makeRepoInfo() },
		);

		await fetchRepo(client, {
			owner: "acme",
			repo: "widget",
			resolvedUser: "bob",
			resolvedVia: "org",
		});

		expect(client.repoCalls).toHaveLength(1);
		expect(client.repoCalls[0]).toEqual({ owner: "acme", repo: "widget" });
	});

	test("passes through repository info unchanged", async () => {
		const repoInfo = makeRepoInfo({
			isArchived: true,
			isPrivate: true,
			primaryLanguage: null,
			licenseInfo: null,
			description: null,
			homepageUrl: null,
		});
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			undefined,
			undefined,
			undefined,
			{ repository: repoInfo },
		);

		const report = await fetchRepo(client, {
			owner: "acme",
			repo: "repo",
			resolvedUser: "alice",
			resolvedVia: "fallback",
		});

		expect(report.repository.isArchived).toBe(true);
		expect(report.repository.isPrivate).toBe(true);
		expect(report.repository.primaryLanguage).toBeNull();
		expect(report.repository.licenseInfo).toBeNull();
		expect(report.repository.description).toBeNull();
		expect(report.repository.homepageUrl).toBeNull();
	});
});
