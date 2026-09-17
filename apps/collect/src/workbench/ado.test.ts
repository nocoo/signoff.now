import { describe, expect, test } from "bun:test";
import type { Project } from "@signoff/domain/workbench";
import { AdoError, type AdoPagedClient } from "../ado/client.js";
import {
	BuildService,
	collectProjectPulls,
	discoverMergeRequirements,
	policyArtifactId,
	policyEvaluationsUrl,
} from "./ado.js";
import { normalizePullRequest } from "./normalize.js";

function makeMockProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "test-proj",
		provider: "ado",
		name: "Test Project",
		organization: "test-org",
		projectKey: "test-project-key",
		description: "A test project",
		owner: "tester",
		enabled: true,
		source: "cli",
		revision: 1,
		createdAt: 1000,
		updatedAt: 1000,
		lastScannedAt: null,
		scanState: "never",
		scanMessage: null,
		...overrides,
	};
}

describe("collectProjectPulls", () => {
	test("discovers enabled blocking requirements across policy pages and only within monitored repositories", async () => {
		const seen: string[] = [];
		const config = (id: number, repositoryId: string | null, extra = {}) => ({
			id,
			isEnabled: true,
			isBlocking: true,
			type: {
				displayName: "Minimum number of reviewers",
				id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd",
			},
			settings: {
				minimumApproverCount: 2,
				scope: [{ repositoryId, refName: "refs/heads/main" }],
			},
			...extra,
		});
		const client = {
			getPage: async (url: string) => {
				seen.push(url);
				return url.includes("continuationToken=")
					? { data: { value: [config(4, null)] }, continuationToken: null }
					: {
							data: {
								value: [
									config(1, "repo"),
									config(2, "other"),
									config(3, "repo", { isBlocking: false }),
								],
							},
							continuationToken: "next",
						};
			},
		} as AdoPagedClient;
		const gates = await discoverMergeRequirements(client, makeMockProject(), [
			{ id: "repo", name: "App", projectGuid: "guid" },
		]);
		expect(gates.map((gate) => gate.id)).toEqual(["policy-1", "policy-4"]);
		expect(gates[0]).toMatchObject({
			kind: "review",
			name: "Minimum number of reviewers",
		});
		expect(gates[0]?.detail).toContain("2 approvals");
		expect(seen).toHaveLength(2);
	});
	test("collects checks only for the visible selection, without enumerating or prefetching other PRs", async () => {
		const project = makeMockProject();
		const raw = (number: number) => ({
			pullRequestId: number,
			status: "active",
			title: `PR ${number}`,
			sourceRefName: "refs/heads/feature",
			targetRefName: "refs/heads/main",
			repository: {
				id: "repo",
				name: "app",
				project: { id: "guid", name: "Project" },
			},
			lastMergeSourceCommit: { commitId: "head" },
		});
		const calls: string[] = [];
		const client: AdoPagedClient = {
			checkAuth: async () => {},
			invalidateToken: () => {},
			post: async () => ({}),
			get: async (url) => {
				calls.push(url);
				return /\/pullrequests\/101\?/i.test(url) ? raw(101) : { value: [] };
			},
			getPage: async (url) => {
				calls.push(url);
				return {
					data: {
						value: url.includes("/_apis/git/repositories?")
							? [
									{
										id: "repo",
										name: "app",
										project: { id: "guid", name: "Project" },
									},
								]
							: url.includes("status=active")
								? [raw(101), raw(202)]
								: [],
					},
					continuationToken: null,
				};
			},
		};
		const target = normalizePullRequest({
			projectId: project.id,
			rawPr: raw(101),
			now: 1_789_632_000,
		});
		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
			targets: [target],
		});
		expect(result.pulls.map((p) => p.number)).toEqual([101]);
		expect(result.pulls[0]?.checksObservedAt).toBe(1_789_632_000);
		expect(result.pulls[0]?.headSha).toBe("head");
		expect(
			calls.some(
				(url) =>
					url.includes("202") ||
					url.includes("status=active") ||
					url.includes("/_apis/git/repositories?"),
			),
		).toBe(false);
	});
	test("automatic discovery lists PR facts without fetching any checks or build timelines", async () => {
		const calls: string[] = [];
		const progress: number[][] = [];
		const client: AdoPagedClient = {
			checkAuth: async () => {},
			invalidateToken: () => {},
			post: async () => ({}),
			get: async (url) => {
				calls.push(url);
				return { value: [] };
			},
			getPage: async (url) => {
				calls.push(url);
				return {
					data: {
						value: url.includes("/_apis/git/repositories?")
							? [
									{
										id: "repo",
										name: "app",
										project: { id: "guid", name: "Project" },
									},
								]
							: url.includes("status=active")
								? [101, 102].map((pullRequestId) => ({
										pullRequestId,
										status: "active",
										title: "PR",
										sourceRefName: "refs/heads/feature",
										targetRefName: "refs/heads/main",
										repository: { id: "repo", name: "app" },
									}))
								: [],
					},
					continuationToken: null,
				};
			},
		};
		const result = await collectProjectPulls({
			project: makeMockProject(),
			client,
			now: 1_789_632_000,
			targets: [],
			onProgress: async (done, total) => {
				progress.push([done, total]);
			},
		});
		expect(progress).toEqual([
			[0, 2],
			[2, 2],
		]);
		expect(result.pulls).toHaveLength(2);
		expect(result.state).toBe("complete");
		expect(result.pulls[0]).toMatchObject({
			coverage: "partial",
			checksObservedAt: null,
			policies: [],
			builds: [],
		});
		expect(
			calls.some((url) =>
				/policy\/evaluations|statuses|builds|timeline|threads|iterations/.test(
					url,
				),
			),
		).toBe(false);
	});
	test("keeps stages when Azure timeline tasks have null identifiers", async () => {
		const client: AdoPagedClient = {
			get: async (url) =>
				url.includes("/timeline")
					? {
							records: [
								{
									id: "checkout-task",
									identifier: null,
									type: "Task",
									name: "Checkout",
									state: "completed",
									result: "succeeded",
								},
								{
									id: "build-stage",
									identifier: "Build",
									type: "Stage",
									name: "Build",
									state: "completed",
									result: "succeeded",
								},
							],
						}
					: { id: 123, status: "completed", result: "succeeded" },
			getPage: async () => ({ data: {}, continuationToken: null }),
			post: async () => ({}),
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		const build = await new BuildService(
			client,
			"test-org",
		).fetchBuildWithStages(123, "test-project");
		expect(build.stages).toHaveLength(1);
		expect(build.stages[0]?.state).toBe("passed");
		expect(build.collectionIssues).toBeUndefined();
	});

	test("policyArtifactId and policyEvaluationsUrl format preview url correctly", () => {
		const artifact = policyArtifactId("proj-guid", 1234);
		expect(artifact).toBe("vstfs:///CodeReview/CodeReviewId/proj-guid/1234");
		const url = policyEvaluationsUrl("org", "proj-guid", 1234);
		expect(url).toContain("api-version=7.1-preview.1");
		expect(url).toContain(
			"vstfs%3A%2F%2F%2FCodeReview%2FCodeReviewId%2Fproj-guid%2F1234",
		);
	});

	test("discovers repositories and collects active and recent PRs with builds and metrics", async () => {
		const repoId = "repo-guid-1";
		const projectGuid = "proj-guid-1";
		const project = makeMockProject();

		const urlsCalled: string[] = [];
		const client: AdoPagedClient = {
			get: async (url) => {
				urlsCalled.push(url);
				if (url.includes("/_apis/git/repositories?")) {
					return {
						value: [
							{
								id: repoId,
								name: "repo-alpha",
								project: { id: projectGuid, name: project.name },
							},
						],
					};
				}
				if (url.toLowerCase().includes("/pullrequests/101/threads")) {
					return {
						value: [
							{
								comments: [
									{ id: 1, isDeleted: false, commentType: "text" },
									{ id: 2, isDeleted: true, commentType: "text" },
									{ id: 3, isDeleted: false, commentType: "system" },
								],
							},
						],
					};
				}
				if (
					url.toLowerCase().includes("/pullrequests/101/iterations/2/changes")
				) {
					return {
						changeCounts: { Add: 3, Edit: 2 },
					};
				}
				if (url.toLowerCase().includes("/pullrequests/101/iterations")) {
					return {
						value: [
							{ id: 1, createdDate: "2026-09-17T01:00:00Z" },
							{ id: 2, createdDate: "2026-09-17T02:00:00Z" },
						],
					};
				}
				if (url.includes("/policy/evaluations")) {
					return {
						value: [
							{
								configuration: {
									id: 50,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Build Policy",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 888 },
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/888/timeline")) {
					return {
						records: [
							{
								id: "s1",
								type: "Stage",
								name: "Build",
								state: "completed",
								result: "succeeded",
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/888")) {
					return {
						id: 888,
						status: "completed",
						result: "succeeded",
						definition: { id: 10, name: "CI Build" },
					};
				}
				if (url.includes("/_apis/build/builds?")) {
					return { value: [] };
				}
				if (url.includes("/statuses")) {
					return { value: [] };
				}
				return { value: [] };
			},
			post: async () => ({ value: [] }),
			getPage: async (url) => {
				urlsCalled.push(url);
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: projectGuid, name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 101,
									status: "active",
									title: "Active PR",
									creationDate: "2026-09-17T01:00:00Z",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=completed")) {
					return {
						data: { value: [] },
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=abandoned")) {
					return {
						data: { value: [] },
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};

		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});

		expect(result.state).toBe("complete");
		expect(result.pulls).toHaveLength(1);
		expect(result.pulls[0]?.id).toBe(`ado:${project.id}:${repoId}:101`);
		expect(result.pulls[0]?.number).toBe(101);
		expect(result.pulls[0]?.title).toBe("Active PR");
		expect(result.pulls[0]?.comments).toBe(1);
		expect(result.pulls[0]?.filesChanged).toBe(5);
		expect(result.pulls[0]?.builds).toHaveLength(1);
		expect(result.pulls[0]?.builds[0]?.name).toBe("CI Build");
		expect(result.pulls[0]?.observedAt).toBe(1_789_632_000);
	});

	test("respects scoped project.repositories and reports error if scoped repo not found", async () => {
		const project = makeMockProject({ repositories: ["missing-repo"] });
		const client: AdoPagedClient = {
			get: async () => ({ value: [] }),
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: "guid-1",
									name: "actual-repo",
									project: { id: "p-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};

		await expect(
			collectProjectPulls({
				project,
				client,
				now: 1_789_632_000,
			}),
		).rejects.toThrow(/missing-repo/i);
	});

	test("handles per-PR detail failures gracefully as partial coverage", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						value: [
							{
								id: repoId,
								name: "repo-alpha",
								project: { id: "proj-guid", name: project.name },
							},
						],
					};
				}
				if (url.includes("/policy/evaluations")) {
					throw new AdoError(
						"bad_request",
						"policy evaluation unavailable",
						400,
					);
				}
				return { value: [] };
			},
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 202,
									status: "active",
									title: "PR with failing details",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};

		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});

		expect(result.state).toBe("partial");
		expect(result.pulls).toHaveLength(1);
		expect(result.pulls[0]?.coverage).toBe("partial");
		expect(result.pulls[0]?.collectionIssues).toBeDefined();
		expect(result.pulls[0]?.collectionIssues?.[0]).toContain("policy");
	});

	test("handles pagination with continuationToken", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		let pageCount = 0;
		const client: AdoPagedClient = {
			get: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						value: [
							{
								id: repoId,
								name: "repo-alpha",
								project: { id: "proj-guid", name: project.name },
							},
						],
					};
				}
				return { value: [] };
			},
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					pageCount++;
					if (pageCount === 1) {
						return {
							data: {
								value: [
									{
										pullRequestId: 1,
										status: "active",
										title: "PR 1",
										repository: { id: repoId, name: "repo-alpha" },
									},
								],
							},
							continuationToken: "token-page-2",
						};
					}
					expect(url).toContain("continuationToken=token-page-2");
					return {
						data: {
							value: [
								{
									pullRequestId: 2,
									status: "active",
									title: "PR 2",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};

		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});

		expect(result.pulls).toHaveLength(2);
		expect(pageCount).toBe(2);
	});

	test("detects cyclic or duplicate PR across pages and fails fatal", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		let callCount = 0;
		const client: AdoPagedClient = {
			get: async () => ({
				value: [
					{
						id: repoId,
						name: "repo-alpha",
						project: { id: "proj-guid", name: project.name },
					},
				],
			}),
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				callCount++;
				return {
					data: {
						value: Array.from({ length: 100 }, (_, i) => ({
							pullRequestId: callCount === 1 ? i + 1 : 1,
							status: "active",
							title: `PR ${i + 1}`,
							repository: { id: repoId, name: "repo-alpha" },
						})),
					},
					continuationToken: null,
				};
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};

		await expect(
			collectProjectPulls({
				project,
				client,
				now: 1_789_632_000,
			}),
		).rejects.toThrow(/Repeated or cyclic PR/);
	});

	test("propagates unauthenticated failure immediately", async () => {
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async () => {
				throw new AdoError("unauthenticated", "az login required", 401);
			},
			post: async () => ({}),
			getPage: async () => {
				throw new AdoError("unauthenticated", "az login required", 401);
			},
			checkAuth: async () => {
				throw new AdoError("unauthenticated", "az login required", 401);
			},
			invalidateToken: () => {},
		};

		await expect(
			collectProjectPulls({
				project,
				client,
				now: 1_789_632_000,
			}),
		).rejects.toThrow("az login required");
	});

	test("keeps PRs with the same id in different repositories", async () => {
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async () => ({ value: [] }),
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: "repo-a",
									name: "alpha",
									project: { id: "proj-guid", name: project.name },
								},
								{
									id: "repo-b",
									name: "beta",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					const repoId = url.includes("repo-a") ? "repo-a" : "repo-b";
					return {
						data: {
							value: [
								{
									pullRequestId: 1,
									status: "active",
									title: `PR in ${repoId}`,
									repository: { id: repoId, name: repoId },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});
		expect(result.pulls).toHaveLength(2);
		expect(new Set(result.pulls.map((p) => p.repository.id))).toEqual(
			new Set(["repo-a", "repo-b"]),
		);
	});

	test("follows repository continuation tokens and rejects cycles", async () => {
		const project = makeMockProject();
		const repoUrls: string[] = [];
		let repoPages = 0;
		const client: AdoPagedClient = {
			get: async () => ({ value: [] }),
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					repoUrls.push(url);
					repoPages++;
					if (repoPages === 1) {
						return {
							data: {
								value: [
									{
										id: "repo-a",
										name: "alpha",
										project: { id: "proj-guid", name: project.name },
									},
								],
							},
							continuationToken: "repos-2",
						};
					}
					expect(url).toContain("continuationToken=repos-2");
					return {
						data: {
							value: [
								{
									id: "repo-b",
									name: "beta",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		await collectProjectPulls({ project, client, now: 1_789_632_000 });
		expect(repoPages).toBe(2);

		const looping: AdoPagedClient = {
			...client,
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: "repo-a",
									name: "alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: "loop",
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
		};
		await expect(
			collectProjectPulls({ project, client: looping, now: 1_789_632_000 }),
		).rejects.toThrow(/Repeated continuation token/);
	});

	test("rejects repeated active PR continuation tokens", async () => {
		const project = makeMockProject();
		let activePages = 0;
		const client: AdoPagedClient = {
			get: async () => ({ value: [] }),
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: "repo-guid-1",
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					activePages++;
					return {
						data: {
							value: [
								{
									pullRequestId: activePages,
									status: "active",
									title: "PR",
									repository: { id: "repo-guid-1", name: "repo-alpha" },
								},
							],
						},
						continuationToken: "same-token",
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		await expect(
			collectProjectPulls({ project, client, now: 1_789_632_000 }),
		).rejects.toThrow(/Repeated continuation token/);
	});

	test("replaces an older policy build with a newer merge build and keeps required", async () => {
		const repoId = "repo-guid-1";
		const projectGuid = "proj-guid";
		const commit = "abc123";
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async (url) => {
				if (url.includes("/policy/evaluations")) {
					return {
						value: [
							{
								status: "approved",
								configuration: {
									id: 50,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Build",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 10 },
							},
							{
								status: "notApplicable",
								configuration: {
									id: 51,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Disabled Build",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 11 },
							},
							{
								configuration: {
									id: 52,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Off Build",
									},
									isBlocking: true,
									isEnabled: false,
								},
								context: { buildId: 12 },
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/10/timeline")) {
					return { records: [] };
				}
				if (url.includes("/_apis/build/builds/10")) {
					return {
						id: 10,
						status: "completed",
						result: "failed",
						definition: { id: 7, name: "CI" },
					};
				}
				if (url.includes("/_apis/build/builds/20/timeline")) {
					return {
						records: [
							{
								id: "s1",
								type: "Stage",
								name: "Build",
								state: "completed",
								result: "succeeded",
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/20")) {
					return {
						id: 20,
						status: "completed",
						result: "succeeded",
						definition: { id: 7, name: "CI" },
						sourceBranch: "refs/pull/101/merge",
						sourceVersion: commit,
						repository: { id: repoId },
					};
				}
				if (url.includes("/builds/11") || url.includes("/builds/12")) {
					throw new Error("should not fetch skipped policy builds");
				}
				return { value: [] };
			},
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: projectGuid, name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 101,
									status: "active",
									title: "PR",
									lastMergeCommit: { commitId: commit },
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("/_apis/build/builds?")) {
					expect(url).toContain("maxBuildsPerDefinition=1");
					expect(url).toContain("queryOrder=queueTimeDescending");
					expect(url).toContain("%24top=100");
					return {
						data: {
							value: [
								{
									id: 20,
									definition: { id: 7, name: "CI" },
									sourceBranch: "refs/pull/101/merge",
									sourceVersion: commit,
									repository: { id: repoId },
								},
								{
									id: 30,
									definition: { id: 8, name: "Other" },
									sourceBranch: "refs/heads/main",
									sourceVersion: commit,
									repository: { id: repoId },
								},
								{
									id: 31,
									definition: { id: 9, name: "Foreign" },
									sourceBranch: "refs/pull/101/merge",
									sourceVersion: commit,
									repository: { id: "other-repo" },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});
		expect(result.pulls[0]?.builds).toHaveLength(1);
		expect(result.pulls[0]?.builds[0]?.id).toBe("20");
		expect(result.pulls[0]?.builds[0]?.required).toBe(true);
		expect(result.pulls[0]?.builds[0]?.state).toBe("passed");
	});

	test("keeps retained policy builds as partial unavailable without fabricating success", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async (url) => {
				if (url.includes("/policy/evaluations")) {
					return {
						value: [
							{
								configuration: {
									id: 50,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Build",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 888 },
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/888")) {
					throw new AdoError("not_found", "not found: build 888", 404);
				}
				return { value: [] };
			},
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 101,
									status: "active",
									title: "PR",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		const result = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});
		expect(result.state).toBe("partial");
		expect(result.pulls[0]?.builds).toEqual([]);
		expect(
			result.pulls[0]?.collectionIssues?.some((i) => i.includes("unavailable")),
		).toBe(true);
	});

	test("records timeline failures except expected 404s on queued builds", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		const client: AdoPagedClient = {
			get: async (url) => {
				if (url.includes("/policy/evaluations")) {
					return {
						value: [
							{
								configuration: {
									id: 1,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Build",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 1 },
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/1/timeline")) {
					throw new AdoError("server", "timeline failed", 500);
				}
				if (url.includes("/_apis/build/builds/1")) {
					return {
						id: 1,
						status: "completed",
						result: "succeeded",
						definition: { id: 1, name: "CI" },
					};
				}
				return { value: [] };
			},
			post: async () => ({}),
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 101,
									status: "active",
									title: "PR",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("/_apis/build/builds?")) {
					throw new AdoError("bad_request", "merge list failed", 400);
				}
				return { data: { value: [] }, continuationToken: null };
			},
			checkAuth: async () => {},
			invalidateToken: () => {},
		};
		const failed = await collectProjectPulls({
			project,
			client,
			now: 1_789_632_000,
		});
		expect(failed.state).toBe("partial");
		expect(
			failed.pulls[0]?.collectionIssues?.some((i) => i.includes("timeline")),
		).toBe(true);
		expect(
			failed.pulls[0]?.collectionIssues?.some((i) =>
				i.includes("Merge builds"),
			),
		).toBe(true);

		const queued: AdoPagedClient = {
			...client,
			get: async (url) => {
				if (url.includes("/policy/evaluations")) {
					return {
						value: [
							{
								configuration: {
									id: 1,
									type: {
										id: "0609b952-1397-4640-95ec-e00a01b2c241",
										displayName: "Build",
									},
									isBlocking: true,
									isEnabled: true,
								},
								context: { buildId: 2 },
							},
						],
					};
				}
				if (url.includes("/_apis/build/builds/2/timeline")) {
					throw new AdoError("not_found", "not found: timeline", 404);
				}
				if (url.includes("/_apis/build/builds/2")) {
					return {
						id: 2,
						status: "notStarted",
						definition: { id: 1, name: "CI" },
					};
				}
				return { value: [] };
			},
			getPage: async (url) => {
				if (url.includes("/_apis/git/repositories?")) {
					return {
						data: {
							value: [
								{
									id: repoId,
									name: "repo-alpha",
									project: { id: "proj-guid", name: project.name },
								},
							],
						},
						continuationToken: null,
					};
				}
				if (url.includes("searchCriteria.status=active")) {
					return {
						data: {
							value: [
								{
									pullRequestId: 101,
									status: "active",
									title: "PR",
									repository: { id: repoId, name: "repo-alpha" },
								},
							],
						},
						continuationToken: null,
					};
				}
				return { data: { value: [] }, continuationToken: null };
			},
		};
		const waiting = await collectProjectPulls({
			project,
			client: queued,
			now: 1_789_632_000,
		});
		expect(
			waiting.pulls[0]?.collectionIssues?.some((i) => i.includes("timeline")),
		).toBeFalsy();
	});

	test("emits onProgress(0, total) and observes PRs after elapsed wall time", async () => {
		const repoId = "repo-guid-1";
		const project = makeMockProject();
		let nowMs = 1_700_000_000_000;
		const realNow = Date.now;
		Date.now = () => nowMs;
		const progress: [number, number][] = [];
		try {
			const client: AdoPagedClient = {
				get: async (url) => {
					if (url.includes("/policy/evaluations")) nowMs += 5000;
					return { value: [] };
				},
				post: async () => ({}),
				getPage: async (url) => {
					if (url.includes("/_apis/git/repositories?")) {
						return {
							data: {
								value: [
									{
										id: repoId,
										name: "repo-alpha",
										project: { id: "proj-guid", name: project.name },
									},
								],
							},
							continuationToken: null,
						};
					}
					if (url.includes("searchCriteria.status=active")) {
						return {
							data: {
								value: [
									{
										pullRequestId: 101,
										status: "active",
										title: "PR",
										creationDate: "2026-09-17T01:00:00Z",
										repository: { id: repoId, name: "repo-alpha" },
									},
								],
							},
							continuationToken: null,
						};
					}
					return { data: { value: [] }, continuationToken: null };
				},
				checkAuth: async () => {},
				invalidateToken: () => {},
			};
			const result = await collectProjectPulls({
				project,
				client,
				now: 1_789_632_000,
				onProgress: async (done, total) => {
					progress.push([done, total]);
				},
			});
			expect(progress[0]).toEqual([0, 1]);
			expect(result.pulls[0]?.observedAt).toBe(1_789_632_000 + 5);
		} finally {
			Date.now = realNow;
		}
	});
});
