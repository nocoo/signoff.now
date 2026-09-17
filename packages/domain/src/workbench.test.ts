import { describe, expect, test } from "bun:test";
import { advanceDemoPull, demoWorkspace, makeDemoPulls } from "./demo.js";
import {
	isFailed,
	projectSchema,
	projectUrl,
	projectWriteSchema,
	pullProgress,
	pullReadiness,
	pullRequestSchema,
	pullUrl,
	workbenchSchema,
} from "./workbench.js";

const now = 1_789_632_000;
const fixture = demoWorkspace(now);
const project = fixture.projects[0]!;
const ready = fixture.pullRequests.find(
	(pr) =>
		pr.projectId === project.id && pullReadiness(pr, project).kind === "ready",
)!;

describe("normalized PR contract", () => {
	test("retains late job failures in pipelines with more than 100 stages", () => {
		const build = ready.builds[0]!;
		const stages = Array.from({ length: 131 }, (_, index) => ({
			...build.stages[0]!,
			id: `matrix-job-${index}`,
			name: `Matrix job ${index + 1}`,
			required: true,
			state: index === 130 ? ("failed" as const) : ("passed" as const),
			detail: index === 130 ? "Fix the final matrix job" : "Job passed",
		}));
		const pull = pullRequestSchema.parse({
			...ready,
			builds: [{ ...build, required: true, state: "passed", stages }],
		});
		expect(pull.builds[0]?.stages).toHaveLength(131);
		expect(pullReadiness(pull, project)).toMatchObject({
			kind: "blocked",
			action: "Fix the final matrix job",
		});
	});

	test("a queued build can be in progress before its timeline exists", () => {
		expect(
			pullReadiness(
				{
					...ready,
					builds: [
						{
							...ready.builds[0]!,
							required: true,
							state: "queued",
							stages: [],
						},
					],
				},
				project,
			).kind,
		).toBe("running");
	});
	test("excludes ineligible self approvals from the minimum reviewer count", () => {
		const pull = pullRequestSchema.parse({
			...ready,
			requiredApprovals: 1,
			reviewers: [
				{
					id: ready.author.id,
					name: ready.author.name,
					vote: "approved",
					required: false,
					countsTowardApproval: false,
				},
			],
		});
		expect(pullReadiness(pull, project)).toMatchObject({
			kind: "review",
			action: "1 more approval needed",
		});
	});
	test("group review rollups do not count as an extra person's approval", () => {
		const pull = pullRequestSchema.parse({
			...ready,
			requiredApprovals: 2,
			reviewers: [
				{ id: "person", name: "Reviewer", vote: "approved", required: false },
				{
					id: "team",
					name: "Review team",
					vote: "approved",
					required: true,
					isGroup: true,
				},
			],
		});
		expect(pull.reviewers[1]?.isGroup).toBe(true);
		expect(pullReadiness(pull, project)).toMatchObject({
			kind: "review",
			action: "1 more approval needed",
		});
	});
	test("contains 46 persistent-ready scenarios across five projects", () => {
		expect(fixture.projects).toHaveLength(5);
		expect(fixture.pullRequests).toHaveLength(46);
		expect(
			workbenchSchema.safeParse({
				...fixture,
				fetchedAt: now,
				demoMode: true,
				truncated: false,
			}).success,
		).toBe(true);
		const kinds = new Set(
			fixture.pullRequests.map(
				(pr) =>
					pullReadiness(
						pr,
						fixture.projects.find((p) => p.id === pr.projectId)!,
					).kind,
			),
		);
		expect([...kinds].sort()).toEqual([
			"approval",
			"blocked",
			"closed",
			"draft",
			"merged",
			"ready",
			"review",
			"running",
			"unknown",
		]);
		expect(
			new Set(fixture.pullRequests.map((pr) => pr.repository.id)).size,
		).toBe(13);
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

describe("merge readiness", () => {
	test("keeps uncollected checks unknown while preserving known blockers", () => {
		const pull = { ...ready, checksObservedAt: null };
		expect(pullReadiness(pull, project)).toMatchObject({
			kind: "unknown",
			label: "Awaiting checks",
		});
		expect(
			pullReadiness({ ...pull, mergeable: "conflicts" }, project).label,
		).toBe("Merge conflict");
		expect(pullReadiness({ ...pull, state: "merged" }, project).kind).toBe(
			"merged",
		);
	});
	test("consolidates identical next actions from distinct policy gates", () => {
		const policies = ["review-policy-a", "review-policy-b"].map((id) => ({
			id,
			name: "Minimum number of reviewers",
			state: "queued" as const,
			required: true,
			detail: "Request the required reviewer approvals",
			owner: "Reviewers",
		}));
		const pull = { ...ready, policies };
		const result = pullReadiness(pull, project);
		expect(pull.policies).toHaveLength(2);
		expect(result.kind).toBe("running");
		expect(result.issues).toHaveLength(1);
		expect(
			pullReadiness(
				{
					...pull,
					policies: [
						{ ...policies[0]!, state: "passed" },
						{ ...policies[1]!, state: "failed" },
					],
				},
				project,
			).kind,
		).toBe("blocked");
	});

	test("does not let optional failures block an otherwise approved PR", () => {
		const optional = fixture.pullRequests.find(
			(pr) => pullProgress(pr).optionalFailures === 2,
		)!;
		expect(pullReadiness(optional, project).kind).toBe("ready");
		expect(pullProgress(optional)).toMatchObject({
			checksPassed: 5,
			checksTotal: 5,
			optionalFailures: 2,
		});
	});
	test("keeps conflicts, changes, and policies ahead of running builds", () => {
		const pr = structuredClone(ready);
		pr.mergeable = "conflicts";
		pr.reviewers[0]!.vote = "changes_requested";
		pr.policies[0]!.state = "failed";
		pr.builds[0]!.state = "running";
		const result = pullReadiness(pr, project);
		expect(result.label).toBe("Merge conflict");
		expect(result.owner).toBe(pr.author.name);
		expect(result.issues.some((i) => i.label === "Changes requested")).toBe(
			true,
		);
		expect(result.issues.some((i) => i.label === "Policy failed")).toBe(true);
	});
	test("withholds ready when any required gate is inconclusive", () => {
		for (const state of [
			"unknown",
			"skipped",
			"waiting",
			"running",
			"queued",
			"canceled",
		] as const) {
			const pr = structuredClone(ready);
			pr.policies[0]!.state = state;
			expect(pullReadiness(pr, project).kind).not.toBe("ready");
		}
		for (const state of [
			"unknown",
			"skipped",
			"waiting",
			"running",
			"queued",
			"canceled",
			"failed",
		] as const) {
			const pr = structuredClone(ready);
			pr.builds[0]!.state = state;
			expect(pullReadiness(pr, project).kind).not.toBe("ready");
			pr.builds[0]!.state = "passed";
			pr.builds[0]!.stages[0]!.state = state;
			expect(pullReadiness(pr, project).kind).not.toBe("ready");
		}
		const pr = structuredClone(ready);
		pr.builds[0]!.stages = [];
		expect(pullReadiness(pr, project).kind).toBe("unknown");
		expect(pullReadiness(ready, { ...project, enabled: false }).label).toBe(
			"Monitoring paused",
		);
		expect(pullReadiness(ready, { ...project, scanState: "failed" }).kind).toBe(
			"unknown",
		);
	});
	test("counts approvals and required reviewers separately", () => {
		const pr = structuredClone(ready);
		pr.requiredApprovals = 1;
		pr.reviewers[1]!.vote = "commented";
		expect(pullReadiness(pr, project).kind).toBe("review");
		pr.reviewers = [];
		expect(pullReadiness(pr, project).action).toBe("1 more approval needed");
		pr.requiredApprovals = 3;
		expect(pullReadiness(pr, project).action).toBe("3 more approvals needed");
	});
});

describe("demo scanning", () => {
	test("advances builds, recovers missing checks, and preserves human gates", () => {
		for (const pr of fixture.pullRequests) {
			const owner = fixture.projects.find((p) => p.id === pr.projectId)!;
			const before = pullReadiness(pr, owner);
			const { pull, advancedStages } = advanceDemoPull(
				pr,
				now + 60,
				"scan-next",
			);
			expect(pullRequestSchema.safeParse(pull).success).toBe(true);
			expect(pull.observedAt).toBe(now + 60);
			expect(pr.observedAt).not.toBe(pull.observedAt);
			if (
				["blocked", "approval", "review", "draft", "merged", "closed"].includes(
					before.kind,
				)
			)
				expect(pullReadiness(pull, owner).kind).toBe(before.kind);
			if (pr.coverage === "partial") expect(pull.coverage).toBe("complete");
			if (advancedStages) expect(pull.updatedAt).toBe(now + 60);
		}
	});
	test("repeated scans finish queued stages without clearing failures or approvals", () => {
		let pulls = fixture.pullRequests;
		for (let i = 0; i < 12; i++)
			pulls = pulls.map(
				(pr) => advanceDemoPull(pr, now + i + 1, `scan-${i}`).pull,
			);
		expect(
			pulls.some((pr) => pullReadiness(pr, project).kind === "running"),
		).toBe(false);
		expect(pulls.some((pr) => pr.builds.some((b) => isFailed(b.state)))).toBe(
			true,
		);
		expect(
			pulls.some((pr) => pr.builds.some((b) => b.state === "waiting")),
		).toBe(true);
		expect(pulls.every((pr) => pr.activity.length <= 12)).toBe(true);
	});
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
