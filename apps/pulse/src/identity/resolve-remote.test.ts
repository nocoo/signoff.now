import { describe, expect, test } from "bun:test";
import { parseRemoteUrl } from "./resolve-remote.ts";

describe("parseRemoteUrl", () => {
	describe("HTTPS GitHub URLs", () => {
		test("parses standard HTTPS URL with .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/alice/my-app.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "my-app",
			});
		});

		test("parses HTTPS URL without .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/alice/my-app");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "my-app",
			});
		});

		test("parses org-owned HTTPS URL", () => {
			const result = parseRemoteUrl("https://github.com/acme-corp/web-app.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "acme-corp",
				repo: "web-app",
			});
		});

		test("parses HTTP URL (upgrades to github platform)", () => {
			const result = parseRemoteUrl("http://github.com/alice/repo.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "repo",
			});
		});
	});

	describe("HTTPS GitHub Enterprise URLs", () => {
		test("parses GHES URL with subdomain", () => {
			const result = parseRemoteUrl(
				"https://github.acme.com/platform/repo.git",
			);
			expect(result).toEqual({
				platform: "github",
				host: "github.acme.com",
				owner: "platform",
				repo: "repo",
			});
		});

		test("parses GHES URL without .git suffix", () => {
			const result = parseRemoteUrl(
				"https://github.corp.example.com/team/project",
			);
			expect(result).toEqual({
				platform: "github",
				host: "github.corp.example.com",
				owner: "team",
				repo: "project",
			});
		});
	});

	describe("SSH GitHub URLs", () => {
		test("parses standard SSH URL", () => {
			const result = parseRemoteUrl("git@github.com:alice/repo.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "repo",
			});
		});

		test("parses SSH URL without .git suffix", () => {
			const result = parseRemoteUrl("git@github.com:alice/repo");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "repo",
			});
		});

		test("parses SSH URL with GHES host", () => {
			const result = parseRemoteUrl("git@github.acme.com:platform/repo.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.acme.com",
				owner: "platform",
				repo: "repo",
			});
		});

		test("parses SSH URL with host alias (gh-work) → defaults host to github.com", () => {
			const result = parseRemoteUrl("git@gh-work:acme-corp/web-app.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "acme-corp",
				repo: "web-app",
			});
		});

		test("parses SSH URL with host alias (gh-personal) → defaults host to github.com", () => {
			const result = parseRemoteUrl("git@gh-personal:alice/my-tool.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "my-tool",
			});
		});

		test("parses SSH URL with dotted repo name", () => {
			const result = parseRemoteUrl("git@gh-personal:alice/my.app.git");
			expect(result).toEqual({
				platform: "github",
				host: "github.com",
				owner: "alice",
				repo: "my.app",
			});
		});
	});

	describe("non-GitHub SSH URLs", () => {
		test("rejects git@gitlab.com as unknown", () => {
			const result = parseRemoteUrl("git@gitlab.com:foo/bar.git");
			expect(result.platform).toBe("unknown");
			expect(result.owner).toBe("");
		});

		test("rejects git@bitbucket.org as unknown", () => {
			const result = parseRemoteUrl("git@bitbucket.org:team/repo.git");
			expect(result.platform).toBe("unknown");
		});

		test("rejects git@codeberg.org as unknown", () => {
			const result = parseRemoteUrl("git@codeberg.org:user/project.git");
			expect(result.platform).toBe("unknown");
		});

		test("rejects git@sr.ht as unknown", () => {
			const result = parseRemoteUrl("git@sr.ht:~user/repo");
			expect(result.platform).toBe("unknown");
		});

		test("rejects git@self-hosted.gitlab.com as unknown", () => {
			const result = parseRemoteUrl("git@self-hosted.gitlab.com:org/repo.git");
			expect(result.platform).toBe("unknown");
		});
	});

	describe("Azure DevOps URLs", () => {
		test("detects visualstudio.com URL", () => {
			const result = parseRemoteUrl(
				"https://contoso.visualstudio.com/DefaultCollection/Project/_git/repo",
			);
			expect(result).toEqual({
				platform: "azure-devops",
				host: "",
				owner: "",
				repo: "",
			});
		});

		test("detects dev.azure.com URL", () => {
			const result = parseRemoteUrl(
				"https://dev.azure.com/contoso/Project/_git/repo",
			);
			expect(result).toEqual({
				platform: "azure-devops",
				host: "",
				owner: "",
				repo: "",
			});
		});
	});

	describe("non-GitHub HTTPS URLs", () => {
		test("returns unknown for GitLab HTTPS", () => {
			const result = parseRemoteUrl("https://gitlab.com/foo/bar.git");
			expect(result).toEqual({
				platform: "unknown",
				host: "",
				owner: "",
				repo: "",
			});
		});

		test("returns unknown for Bitbucket HTTPS", () => {
			const result = parseRemoteUrl("https://bitbucket.org/team/repo.git");
			expect(result).toEqual({
				platform: "unknown",
				host: "",
				owner: "",
				repo: "",
			});
		});
	});

	describe("unknown formats", () => {
		test("returns unknown for empty string", () => {
			const result = parseRemoteUrl("");
			expect(result).toEqual({
				platform: "unknown",
				host: "",
				owner: "",
				repo: "",
			});
		});

		test("returns unknown for malformed URL", () => {
			const result = parseRemoteUrl("not-a-url");
			expect(result).toEqual({
				platform: "unknown",
				host: "",
				owner: "",
				repo: "",
			});
		});
	});
});
