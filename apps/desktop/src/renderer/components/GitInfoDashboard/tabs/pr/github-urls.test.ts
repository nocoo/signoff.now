/**
 * Tests for GitHub URL builder and parser.
 */

import { describe, expect, test } from "bun:test";
import type { GitHubUrlContext } from "./github-urls";
import { buildGitHubUrl, parseGitHubPrUrl } from "./github-urls";

// ─── Shared Fixtures ─────────────────────────────────────────────────

const ctx: GitHubUrlContext = {
	origin: "https://github.com",
	owner: "octocat",
	repo: "hello-world",
	headRefOid: "abc1234",
	baseRefOid: "def5678",
};

const enterpriseCtx: GitHubUrlContext = {
	origin: "https://github.example.com",
	owner: "corp",
	repo: "internal",
	headRefOid: "aaa1111",
	baseRefOid: "bbb2222",
};

// ─── buildGitHubUrl ──────────────────────────────────────────────────

describe("buildGitHubUrl", () => {
	test("builds PR URL", () => {
		expect(buildGitHubUrl(ctx, { type: "pr", number: 42 })).toBe(
			"https://github.com/octocat/hello-world/pull/42",
		);
	});

	test("builds user URL", () => {
		expect(buildGitHubUrl(ctx, { type: "user", login: "alice" })).toBe(
			"https://github.com/alice",
		);
	});

	test("builds branch URL", () => {
		expect(buildGitHubUrl(ctx, { type: "branch", name: "feature/login" })).toBe(
			"https://github.com/octocat/hello-world/tree/feature%2Flogin",
		);
	});

	test("builds commit URL", () => {
		expect(buildGitHubUrl(ctx, { type: "commit", sha: "abc1234" })).toBe(
			"https://github.com/octocat/hello-world/commit/abc1234",
		);
	});

	test("builds file URL with line number", () => {
		expect(
			buildGitHubUrl(ctx, {
				type: "file",
				path: "src/index.ts",
				line: 42,
			}),
		).toBe(
			"https://github.com/octocat/hello-world/blob/abc1234/src/index.ts#L42",
		);
	});

	test("builds file URL without line number", () => {
		expect(buildGitHubUrl(ctx, { type: "file", path: "README.md" })).toBe(
			"https://github.com/octocat/hello-world/blob/abc1234/README.md",
		);
	});

	test("builds file URL with explicit ref", () => {
		expect(
			buildGitHubUrl(ctx, {
				type: "file",
				path: "src/old.ts",
				ref: "def5678",
			}),
		).toBe("https://github.com/octocat/hello-world/blob/def5678/src/old.ts");
	});

	test("builds file URL with null line", () => {
		expect(
			buildGitHubUrl(ctx, {
				type: "file",
				path: "src/app.ts",
				line: null,
			}),
		).toBe("https://github.com/octocat/hello-world/blob/abc1234/src/app.ts");
	});

	test("falls back to HEAD when no headRefOid", () => {
		const noOidCtx: GitHubUrlContext = {
			origin: "https://github.com",
			owner: "octocat",
			repo: "hello-world",
		};
		expect(buildGitHubUrl(noOidCtx, { type: "file", path: "src/app.ts" })).toBe(
			"https://github.com/octocat/hello-world/blob/HEAD/src/app.ts",
		);
	});

	test("builds label URL with special characters", () => {
		expect(buildGitHubUrl(ctx, { type: "label", name: "bug fix" })).toBe(
			"https://github.com/octocat/hello-world/labels/bug%20fix",
		);
	});

	test("builds milestones URL", () => {
		expect(buildGitHubUrl(ctx, { type: "milestones" })).toBe(
			"https://github.com/octocat/hello-world/milestones",
		);
	});

	test("strips trailing slash from origin", () => {
		const trailingCtx: GitHubUrlContext = {
			...ctx,
			origin: "https://github.com/",
		};
		expect(buildGitHubUrl(trailingCtx, { type: "user", login: "alice" })).toBe(
			"https://github.com/alice",
		);
	});

	test("works with GitHub Enterprise origin", () => {
		expect(buildGitHubUrl(enterpriseCtx, { type: "pr", number: 10 })).toBe(
			"https://github.example.com/corp/internal/pull/10",
		);
	});

	test("encodes special characters in owner and repo", () => {
		const specialCtx: GitHubUrlContext = {
			origin: "https://github.com",
			owner: "my org",
			repo: "my repo",
		};
		expect(buildGitHubUrl(specialCtx, { type: "milestones" })).toBe(
			"https://github.com/my%20org/my%20repo/milestones",
		);
	});

	test("encodes special characters in user login", () => {
		expect(buildGitHubUrl(ctx, { type: "user", login: "user name" })).toBe(
			"https://github.com/user%20name",
		);
	});

	test("encodes branch name with slashes and special chars", () => {
		expect(
			buildGitHubUrl(ctx, {
				type: "branch",
				name: "release/v2.0 beta",
			}),
		).toBe("https://github.com/octocat/hello-world/tree/release%2Fv2.0%20beta");
	});
});

// ─── parseGitHubPrUrl ────────────────────────────────────────────────

describe("parseGitHubPrUrl", () => {
	test("parses standard github.com PR URL", () => {
		const result = parseGitHubPrUrl(
			"https://github.com/octocat/hello-world/pull/42",
		);
		expect(result).toEqual({
			origin: "https://github.com",
			owner: "octocat",
			repo: "hello-world",
		});
	});

	test("parses GitHub Enterprise PR URL", () => {
		const result = parseGitHubPrUrl(
			"https://github.example.com/corp/internal/pull/10",
		);
		expect(result).toEqual({
			origin: "https://github.example.com",
			owner: "corp",
			repo: "internal",
		});
	});

	test("parses PR URL with extra path segments", () => {
		// e.g. /pull/42/files or /pull/42/commits
		const result = parseGitHubPrUrl(
			"https://github.com/octocat/hello-world/pull/42/files",
		);
		expect(result).toEqual({
			origin: "https://github.com",
			owner: "octocat",
			repo: "hello-world",
		});
	});

	test("returns null for non-PR URL", () => {
		expect(
			parseGitHubPrUrl("https://github.com/octocat/hello-world"),
		).toBeNull();
	});

	test("returns null for issues URL", () => {
		expect(
			parseGitHubPrUrl("https://github.com/octocat/hello-world/issues/42"),
		).toBeNull();
	});

	test("returns null for malformed URL", () => {
		expect(parseGitHubPrUrl("not-a-url")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parseGitHubPrUrl("")).toBeNull();
	});

	test("returns null for URL with only owner", () => {
		expect(parseGitHubPrUrl("https://github.com/octocat/pull/42")).toBeNull();
	});

	test("parses URL with port number", () => {
		const result = parseGitHubPrUrl(
			"https://github.local:8443/team/project/pull/1",
		);
		expect(result).toEqual({
			origin: "https://github.local:8443",
			owner: "team",
			repo: "project",
		});
	});
});
