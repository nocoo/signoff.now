import { describe, expect, test } from "bun:test";
import { advanceDemoPull, demoWorkspace, makeDemoPulls } from "./demo.js";
import {
	organizationUrl,
	projectSchema,
	projectUrl,
	projectWriteSchema,
	pullProgress,
	pullRequestSchema,
	pullUrl,
	repositoryBranchUrl,
	repositoryUrl,
} from "./workbench.js";

const now = 1_789_632_000;
const fixture = demoWorkspace(now);
const project = fixture.projects[0]!;
const ready = fixture.pullRequests.find(
	(pr) =>
		pr.state === "open" &&
		!pr.draft &&
		pr.builds.every((b) => b.state === "passed"),
)!;

describe("normalized PR contract", () => {
	test("retains optional author handles and avatars through snapshot validation", () => {
		const author = {
			...ready.author,
			handle: "alice@example.com",
			avatarUrl: "https://example.com/alice.png",
		};
		expect(pullRequestSchema.parse({ ...ready, author }).author).toEqual(
			author,
		);
	});

	test("organizes GitHub samples by host, owner, and repository", () => {
		const github = fixture.projects.find((p) => p.provider === "github");
		expect(github).toMatchObject({
			organization: "github.com",
			projectKey: "nocoo",
			repositories: ["signoff.now"],
			source: "demo",
		});
		if (!github) throw new Error("Expected the GitHub sample project");
		const pulls = fixture.pullRequests.filter((p) => p.projectId === github.id);
		expect(pulls).toHaveLength(8);
		expect(pulls.every((p) => p.repository.name === "signoff.now")).toBe(true);
		expect(pulls[0]?.activity.at(-1)?.actor).toBe("GitHub Actions");
		expect(pulls[0]?.policies[0]?.name).toBe("Linked issue");
		expect(projectUrl(github)).toBe("https://github.com/nocoo");
		expect(pullUrl(github, pulls[0]!)).toBe(
			"https://github.com/nocoo/signoff.now/pull/101",
		);
	});

	test("retains one provider-neutral shape and safely constructs provider links", () => {
		const github = projectSchema.parse({
			...project,
			provider: "github",
			organization: "github.com",
			projectKey: "northstar-demo",
		});
		expect(pullRequestSchema.parse(ready)).toEqual(ready);
		expect(projectUrl(github)).toBe("https://github.com/northstar-demo");
		expect(pullUrl(github, ready)).toContain(`/pull/${ready.number}`);
		expect(
			pullUrl({ ...project, projectKey: "Shared Platform" }, ready),
		).toContain("Shared%20Platform/_git/");
	});
	test("links each provider scope without trusting names as URLs", () => {
		const ado = {
			...project,
			organization: "north star?host=evil.test",
			projectKey: "Shared Platform/#overview",
		};
		const repo = "web app?tab=code#main";
		expect(organizationUrl(ado)).toBe(
			"https://dev.azure.com/north%20star%3Fhost%3Devil.test",
		);
		expect(projectUrl(ado)).toBe(
			`${organizationUrl(ado)}/Shared%20Platform%2F%23overview`,
		);
		expect(repositoryUrl(ado, repo)).toBe(
			`${projectUrl(ado)}/_git/web%20app%3Ftab%3Dcode%23main`,
		);
		expect(
			pullUrl(ado, { ...ready, repository: { id: "repo", name: repo } }),
		).toBe(`${repositoryUrl(ado, "repo")}/pullrequest/${ready.number}`);
		expect(repositoryUrl(ado, { id: null, name: repo })).toBe(
			repositoryUrl(ado, repo),
		);
		const github = {
			...project,
			provider: "github" as const,
			organization: "https://evil.test",
			projectKey: "owner/name",
		};
		expect(organizationUrl(github)).toBe("https://github.com");
		expect(projectUrl(github)).toBe("https://github.com/owner%2Fname");
		expect(repositoryUrl(github, "signoff.now")).toBe(
			"https://github.com/owner%2Fname/signoff.now",
		);
		expect(
			pullUrl(github, {
				...ready,
				repository: { id: "repo", name: "signoff.now" },
			}),
		).toBe(`${repositoryUrl(github, "signoff.now")}/pull/${ready.number}`);
	});
	test.each([
		"main",
		"master",
		"release/2026.09",
		"feature/修复?x=1#code",
	])("links target branch %s using provider repository identity and an encoded ref", (branch) => {
		const repository = { id: "stable-repository-guid", name: "web app" };
		const ado = {
			...project,
			organization: "org",
			projectKey: "Shared Platform",
		};
		const adoUrl = new URL(repositoryBranchUrl(ado, repository, branch));
		expect(adoUrl.origin).toBe("https://dev.azure.com");
		expect(adoUrl.pathname).toBe(
			"/org/Shared%20Platform/_git/stable-repository-guid",
		);
		expect(adoUrl.searchParams.get("version")).toBe(`GB${branch}`);
		expect([...adoUrl.searchParams.keys()]).toEqual(["version"]);
		expect(adoUrl.hash).toBe("");
		const github = {
			...ado,
			provider: "github" as const,
			organization: "github.com",
			projectKey: "nocoo",
		};
		expect(repositoryBranchUrl(github, repository, branch)).toBe(
			`https://github.com/nocoo/web%20app/tree/${encodeURIComponent(branch)}`,
		);
	});
	test("validates ADO configuration without accepting URLs or unsupported connectors", () => {
		const body = {
			name: " Sample ",
			organization: "northstar",
			projectKey: "Platform",
			description: "",
			owner: "Maya",
			enabled: true,
			provider: "ado",
		};
		expect(projectWriteSchema.parse(body).name).toBe("Sample");
		for (const invalid of [
			{ provider: "github" },
			{ organization: "https://dev.azure.com/northstar" },
			{ projectKey: "a/b" },
			{ projectKey: "a\nb" },
			{ projectKey: "a\u0000b" },
			{ owner: " " },
			{ source: "cli" },
		]) {
			expect(
				projectWriteSchema.safeParse({ ...body, ...invalid }).success,
			).toBe(false);
		}
	});
});

describe("merge readiness", () => {});

describe("demo scanning", () => {
	test("can seed a newly added project and respects optional skipped stages", () => {
		expect(
			makeDemoPulls(
				{ ...project, id: "new-project", lastScannedAt: null },
				now,
			),
		).toHaveLength(6);
		const pr = structuredClone(ready);
		pr.builds[0]!.stages[0]!.state = "skipped";
		pr.builds[0]!.stages[0]!.required = false;
		pr.builds[0]!.stages[1]!.state = "queued";
		expect(advanceDemoPull(pr, now, "skip-scan").advancedStages).toBe(1);
		expect(pullProgress(pr).stagesPassed).toBeGreaterThan(0);
		pr.coverage = "partial";
		pr.policies[0]!.state = "unknown";
		expect(advanceDemoPull(pr, now, "recover").pull.policies[0]!.state).toBe(
			"passed",
		);
	});
});
