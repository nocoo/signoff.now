import { describe, expect, test } from "bun:test";
import { demoWorkspace } from "./demo";
import {
	canonicalObservationKey,
	makeWatchRef,
	matchesRepositoryReference,
	mergeDiscoveredPull,
	parsePullReference,
	parseRepositoryReference,
	publicSource,
	referenceLinks,
	storageSource,
} from "./monitoring";

const workspace = demoWorkspace(1_800_000_000);
const project = workspace.projects[0]!;
const pull = workspace.pullRequests[0]!;

describe("provider-neutral observation identity", () => {
	test.each([
		"ado",
		"github",
	] as const)("repository references prefer known stable IDs to names and retained aliases (%s)", (provider) => {
		const first = { id: "stable-id", name: "Éditeur", aliases: ["Παλαιό"] };
		const other = { id: "other-id", name: first.id, aliases: [first.id] };
		const ids = [first.id, other.id];
		expect(matchesRepositoryReference(first, "STABLE-ID", provider, ids)).toBe(
			true,
		);
		expect(matchesRepositoryReference(other, "stable-id", provider, ids)).toBe(
			false,
		);
		expect(matchesRepositoryReference(first, "éditeur", provider, ids)).toBe(
			true,
		);
		expect(matchesRepositoryReference(first, "παλαιό", provider, ids)).toBe(
			true,
		);
		expect(matchesRepositoryReference(first, "missing", provider, ids)).toBe(
			false,
		);
	});
	test("ADO GUID references remain IDs before discovery, while GitHub names keep their own grammar", () => {
		const id = "abcdefab-1111-2222-3333-123456789abc";
		const repo = { id: "another-id", name: id };
		expect(matchesRepositoryReference(repo, id.toUpperCase(), "ado", [])).toBe(
			false,
		);
		expect(
			matchesRepositoryReference({ ...repo, id }, id.toUpperCase(), "ado", []),
		).toBe(true);
		expect(matchesRepositoryReference(repo, id, "github", [])).toBe(true);
	});
	test("source conversion and links preserve encoded parent identities", () => {
		for (const source of ["live", "sample"] as const)
			expect(publicSource(storageSource(source))).toBe(source);
		const ref = makeWatchRef(
			{ ...project, organization: "My Org", projectKey: "My Project" },
			{ id: "repo-guid", name: "My Repo" },
			7,
		);
		expect(referenceLinks(ref).repository.url).toBe(
			"https://dev.azure.com/My%20Org/My%20Project/_git/My%20Repo",
		);
		const github = makeWatchRef(
			{
				...project,
				provider: "github",
				organization: "github.com",
				projectKey: "nocoo",
			},
			{ id: "repo-node", name: "signoff.now" },
			7,
		);
		expect(referenceLinks(github)).toMatchObject({
			organization: { url: "https://github.com" },
			project: { url: "https://github.com/nocoo" },
		});
		expect(github.url).toBe("https://github.com/nocoo/signoff.now/pull/7");
		expect(() =>
			parseRepositoryReference("https://github.com/nocoo"),
		).toThrow();
	});
	test("parses ADO and GitHub scopes without losing parents", () => {
		expect(
			parsePullReference(
				"https://dev.azure.com/msdata/Vienna/_git/online-meetings/pullrequest/42/",
			),
		).toMatchObject({
			provider: "ado",
			organization: "msdata",
			projectKey: "Vienna",
			repository: "online-meetings",
			number: 42,
		});
		expect(
			parseRepositoryReference("https://github.com/nocoo/signoff.now/"),
		).toEqual({
			provider: "github",
			organization: "github.com",
			projectKey: "nocoo",
			repository: "signoff.now",
			repositoryUrl: "https://github.com/nocoo/signoff.now",
		});
		expect(
			parsePullReference("https://github.com/nocoo/signoff.now/pull/42").number,
		).toBe(42);
		expect(
			parseRepositoryReference(
				"https://dev.azure.com/org/My%20Project/_git/My%20Repo",
			).projectKey,
		).toBe("My Project");
	});
	test.each([
		"%ZZ",
		"%E0%A4%A",
		"%",
	])("malformed URL encoding is a reference type error: %s", (segment) => {
		for (const url of [
			`https://dev.azure.com/o/p/_git/${segment}`,
			`https://github.com/o/${segment}`,
		]) {
			expect(() => parseRepositoryReference(url)).toThrow(TypeError);
			expect(() =>
				parsePullReference(
					`${url}/${url.includes("dev.azure.com") ? "pullrequest" : "pull"}/1`,
				),
			).toThrow(TypeError);
		}
	});
	test.each([
		"http://dev.azure.com/o/p/_git/r/pullrequest/1",
		"https://evil.test/o/p/_git/r/pullrequest/1",
		"https://user@dev.azure.com/o/p/_git/r/pullrequest/1",
		"https://dev.azure.com/o/p/_git/r/pullrequest/01",
		"https://dev.azure.com/o/p/_git/r/pullrequest/0",
		"https://dev.azure.com/o/p/_git/r/pullrequest/1?x=1",
		"https://dev.azure.com/o/p/_git/r/pullrequest/1#x",
		"https://dev.azure.com/o/p/_git/r/pullrequest/9007199254740992",
		"https://dev.azure.com/o/p/_git/r%2fother/pullrequest/1",
		"https://github.com/o/r/issues/1",
		"https://github.com/o/r/pull/1/extra",
		"https://dev.azure.com/o/p/_git/%ZZ/pullrequest/1",
		"https://dev.azure.com/o/p/_git/r/../r/pullrequest/1",
		"42",
	])("rejects ambiguous or unsafe references: %s", (value) => {
		expect(() => parsePullReference(value)).toThrow();
	});
	test("same numbers remain distinct across source, provider, org, project and repository", () => {
		const ref = makeWatchRef(project, { id: "GUID-A", name: "web" }, 42);
		const key = canonicalObservationKey("cli", ref);
		expect(
			canonicalObservationKey("cli", {
				...ref,
				organization: ref.organization.toUpperCase(),
				projectKey: ref.projectKey.toUpperCase(),
				repository: { ...ref.repository, id: "guid-a", name: "renamed" },
			}),
		).toBe(key);
		const keys = [
			key,
			canonicalObservationKey("demo", ref),
			...[
				{ ...ref, provider: "github" as const },
				{ ...ref, organization: "other" },
				{ ...ref, projectKey: "other" },
				{ ...ref, repository: { id: "other", name: "web" } },
				{ ...ref, number: 43 },
			].map((value) => canonicalObservationKey("cli", value)),
		];
		expect(new Set(keys).size).toBe(keys.length);
		expect(ref.url).toContain("/pullrequest/42");
	});
});

describe("discovery preserves only applicable checks", () => {
	const cached = {
		...pull,
		headSha: "head",
		targetSha: "target",
		checksObservedAt: 500,
		observedAt: 550,
	};
	const discovered = {
		...cached,
		title: "New title",
		observedAt: 600,
		checksObservedAt: null,
		policies: [],
		builds: [],
		reviewers: [],
		coverage: "partial" as const,
	};
	test("keeps old check timestamps, new base facts and fresh reviewer votes", () => {
		const old = {
			...cached,
			authorCountsTowardApproval: false,
			reviewers: [
				{
					...pull.author,
					vote: "approved" as const,
					required: false,
					countsTowardApproval: false,
				},
			],
		};
		const fresh = {
			...discovered,
			reviewers: [
				{ ...pull.author, vote: "pending" as const, required: false },
			],
		};
		const merged = mergeDiscoveredPull(fresh, old);
		expect(merged).toMatchObject({
			title: "New title",
			observedAt: 600,
			checksObservedAt: 500,
			policies: old.policies,
		});
		expect(merged.reviewers[0]).toMatchObject({
			vote: "pending",
			countsTowardApproval: false,
		});
	});
	test("invalidates checks when head, target SHA or target branch changes or is missing", () => {
		for (const patch of [
			{ headSha: "new" },
			{ targetSha: "new" },
			{ targetBranch: "release" },
			{ headSha: null },
			{ targetSha: null },
		]) {
			expect(
				mergeDiscoveredPull({ ...discovered, ...patch }, cached)
					.checksObservedAt,
			).toBeNull();
			expect(
				mergeDiscoveredPull({ ...discovered, ...patch }, cached)
					.checksInvalidated,
			).toBe(true);
		}
		expect(mergeDiscoveredPull(discovered, undefined)).toEqual(discovered);
	});
	test("retains missing checks as missing and preserves author eligibility for newly appearing reviewers", () => {
		const without = {
			...cached,
			checksObservedAt: null,
			reviewers: [],
			authorCountsTowardApproval: false,
		};
		const fresh = {
			...discovered,
			reviewers: [
				{ ...pull.author, vote: "approved" as const, required: false },
			],
		};
		expect(mergeDiscoveredPull(fresh, without).checksObservedAt).toBeNull();
		expect(
			mergeDiscoveredPull(fresh, without).reviewers[0]?.countsTowardApproval,
		).toBe(false);
		const legacy = { ...cached, checksObservedAt: undefined, reviewers: [] };
		expect(mergeDiscoveredPull(fresh, legacy).checksObservedAt).toBe(
			legacy.observedAt,
		);
	});
});
