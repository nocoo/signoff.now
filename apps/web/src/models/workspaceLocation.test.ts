import { describe, expect, it } from "vitest";
import { fixtureProject, fixturePull } from "@/test/monitoring-fixture";
import {
	machineHref,
	matchesProject,
	parseWorkspaceLocation,
	policyHref,
	pullHref,
	sourceFromParams,
	traceReference,
} from "./workspaceLocation";

const project = {
	...fixtureProject,
	organization: "intentional",
	projectKey: "intent",
};
const repository = { id: "stable-repository", name: "whiteboard-app" };
const pull = { ...fixturePull, repository, number: 59380 };

describe("workspace resource URLs", () => {
	it("uses scoped resource paths and keeps trace and view parameters separate", () => {
		const params = new URLSearchParams(
			"tab=priority&view=transitions&gates=pr",
		);
		expect(machineHref(project, repository, pull, params)).toBe(
			"/sm/ado/intentional/intent/whiteboard-app?tab=priority&view=transitions&gates=pr&pr=59380",
		);
		expect(machineHref(project, null, pull)).toBe(
			"/sm/ado/intentional/intent?pr=whiteboard-app%2F59380",
		);
		expect(
			pullHref(project, pull, new URLSearchParams("watching=watching")),
		).toBe(
			"/prs/ado/intentional/intent/whiteboard-app/59380?watching=watching",
		);
		expect(params.toString()).toBe("tab=priority&view=transitions&gates=pr");
		const current = new URLSearchParams(
			"pr=59380&tab=history&view=transitions",
		);
		expect(machineHref(project, repository, pull, current)).toBe(
			`/sm/ado/intentional/intent/whiteboard-app?${current}`,
		);
	});
	it("removes legacy resource IDs while retaining view parameters and explicit Sample scope", () => {
		const params = new URLSearchParams({
			source: "demo",
			project: project.id,
			repo: repository.id,
			trace: pull.id,
			tab: "states",
		});
		expect(
			machineHref({ ...project, source: "demo" }, repository, pull, params),
		).toBe(
			"/sm/ado/intentional/intent/whiteboard-app?source=sample&tab=states&pr=59380",
		);
		expect(
			pullHref(
				project,
				pull,
				new URLSearchParams("pr=old&project=filter-project&page=2"),
			),
		).toBe(
			"/prs/ado/intentional/intent/whiteboard-app/59380?project=filter-project&page=2",
		);
	});
	it("round-trips Unicode, spaces and literal percent signs without losing scope", () => {
		const special = {
			...project,
			organization: "组织",
			projectKey: "Core 100%",
		};
		const repo = { ...repository, name: "图表 + UI" };
		const path = machineHref(special, repo);
		expect(parseWorkspaceLocation(path)).toMatchObject({
			section: "sm",
			valid: true,
			project: {
				provider: "ado",
				organization: "组织",
				projectKey: "Core 100%",
			},
			repository: "图表 + UI",
			number: null,
		});
		expect(traceReference(parseWorkspaceLocation(path)!, "59380")).toEqual({
			repositoryUrl:
				"https://dev.azure.com/%E7%BB%84%E7%BB%87/Core%20100%25/_git/%E5%9B%BE%E8%A1%A8%20%2B%20UI",
			number: 59380,
		});
	});
	it("uses the provider hierarchy for GitHub and keeps project-wide traces scoped by repository", () => {
		const github = {
			...project,
			provider: "github" as const,
			organization: "github.com",
			projectKey: "nocoo",
		};
		expect(pullHref(github, pull)).toBe(
			"/prs/github/nocoo/whiteboard-app/59380",
		);
		expect(
			parseWorkspaceLocation("/prs/github/nocoo/whiteboard-app/59380"),
		).toMatchObject({
			section: "prs",
			valid: true,
			project: {
				provider: "github",
				organization: "github.com",
				projectKey: "nocoo",
			},
			repository: "whiteboard-app",
			number: 59380,
		});
		expect(
			traceReference(
				parseWorkspaceLocation("/sm/github/nocoo")!,
				"whiteboard-app/59380",
			),
		).toEqual({
			repositoryUrl: "https://github.com/nocoo/whiteboard-app",
			number: 59380,
		});
	});
	it("does not interpret an ADO repository name that looks like an ID as another repository", () => {
		const repo = {
			id: "22222222-2222-2222-2222-222222222222",
			name: "11111111-1111-1111-1111-111111111111",
		};
		expect(machineHref(project, repo)).toBe(
			`/sm/ado/intentional/intent/${repo.id}`,
		);
	});
	it("matches the complete project scope and accepts old source names", () => {
		expect(
			matchesProject(project, {
				...project,
				organization: "INTENTIONAL",
				projectKey: "Intent",
			}),
		).toBe(true);
		for (const other of [
			{ ...project, organization: "another" },
			{ ...project, projectKey: "another" },
			{ ...project, provider: "github" as const },
		])
			expect(matchesProject(project, other)).toBe(false);
		for (const source of ["sample", "demo"])
			expect(sourceFromParams(new URLSearchParams({ source }))).toBe("demo");
		for (const source of ["live", "cli"])
			expect(sourceFromParams(new URLSearchParams({ source }), "demo")).toBe(
				"cli",
			);
		expect(
			sourceFromParams(new URLSearchParams("source=unknown"), "demo"),
		).toBe("demo");
	});
	it("recognizes old entry points and rejects incomplete, malformed and unscoped resources", () => {
		for (const path of ["/", "/prs", "/sm", "/state-machines/"])
			expect(parseWorkspaceLocation(path)).toMatchObject({
				valid: true,
				project: null,
			});
		for (const path of [
			"/sm/ado/org",
			"/sm/ado//project",
			"/sm/github",
			"/sm/ado/org/%2e%2e",
			"/sm/ado/org/%2f",
			"/prs/ado/org/project/repo",
			"/prs/ado/org/project/repo/0",
			"/prs/ado/org/project/repo/1e2",
			"/prs/ado/org/project/repo/9007199254740992",
			"/sm/gitlab/org/project",
			"/sm/ado/org/%ZZ",
			"/sm/ado/org/project/repo/123",
		])
			expect(parseWorkspaceLocation(path)?.valid).toBe(false);
		expect(parseWorkspaceLocation("/settings")).toBeNull();
		const scope = parseWorkspaceLocation("/sm/ado/org/project")!;
		for (const value of [
			"123",
			"repo/-1",
			"repo/0",
			"repo/1/2",
			"repo/NaN",
			"repo/9007199254740992",
		])
			expect(traceReference(scope, value)).toBeNull();
		expect(traceReference(scope, null)).toBeNull();
		expect(
			traceReference(parseWorkspaceLocation("/sm/ado")!, "repo/123"),
		).toBeNull();
		expect(
			traceReference(parseWorkspaceLocation("/sm")!, "repo/123"),
		).toBeNull();
	});
});

it("policy instructions have their own System route with source and repository scope", () => {
	expect(policyHref(project, repository)).toBe(
		"/policy-instructions/ado/intentional/intent/whiteboard-app",
	);
});
