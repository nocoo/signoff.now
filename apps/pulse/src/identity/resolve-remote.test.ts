import { describe, expect, test } from "bun:test";
import { parseRemoteUrl } from "./resolve-remote.ts";

describe("parseRemoteUrl", () => {
	describe("HTTPS GitHub URLs", () => {
		test("parses standard HTTPS URL with .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/alice/my-app.git");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "my-app",
			});
		});

		test("parses HTTPS URL without .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/alice/my-app");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "my-app",
			});
		});

		test("parses org-owned HTTPS URL", () => {
			const result = parseRemoteUrl("https://github.com/acme-corp/web-app.git");
			expect(result).toEqual({
				platform: "github",
				owner: "acme-corp",
				repo: "web-app",
			});
		});

		test("parses HTTP URL (upgrades to github platform)", () => {
			const result = parseRemoteUrl("http://github.com/alice/repo.git");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "repo",
			});
		});
	});

	describe("SSH GitHub URLs", () => {
		test("parses standard SSH URL", () => {
			const result = parseRemoteUrl("git@github.com:alice/repo.git");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "repo",
			});
		});

		test("parses SSH URL without .git suffix", () => {
			const result = parseRemoteUrl("git@github.com:alice/repo");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "repo",
			});
		});

		test("parses SSH URL with host alias (gh-work)", () => {
			const result = parseRemoteUrl("git@gh-work:acme-corp/web-app.git");
			expect(result).toEqual({
				platform: "github",
				owner: "acme-corp",
				repo: "web-app",
			});
		});

		test("parses SSH URL with host alias (gh-personal)", () => {
			const result = parseRemoteUrl("git@gh-personal:alice/my-tool.git");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "my-tool",
			});
		});

		test("parses SSH URL with dotted repo name", () => {
			const result = parseRemoteUrl("git@gh-personal:alice/my.app.git");
			expect(result).toEqual({
				platform: "github",
				owner: "alice",
				repo: "my.app",
			});
		});
	});

	describe("Azure DevOps URLs", () => {
		test("detects visualstudio.com URL", () => {
			const result = parseRemoteUrl(
				"https://contoso.visualstudio.com/DefaultCollection/Project/_git/repo",
			);
			expect(result).toEqual({
				platform: "azure-devops",
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
				owner: "",
				repo: "",
			});
		});
	});

	describe("unknown formats", () => {
		test("returns unknown for unrecognized URL", () => {
			const result = parseRemoteUrl("https://gitlab.com/foo/bar.git");
			expect(result).toEqual({
				platform: "unknown",
				owner: "",
				repo: "",
			});
		});

		test("returns unknown for empty string", () => {
			const result = parseRemoteUrl("");
			expect(result).toEqual({
				platform: "unknown",
				owner: "",
				repo: "",
			});
		});

		test("returns unknown for malformed URL", () => {
			const result = parseRemoteUrl("not-a-url");
			expect(result).toEqual({
				platform: "unknown",
				owner: "",
				repo: "",
			});
		});
	});
});
