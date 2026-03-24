import { describe, expect, test } from "bun:test";
import { parseRemoteUrl } from "./resolve-remote.ts";

describe("parseRemoteUrl", () => {
	describe("HTTPS GitHub URLs", () => {
		test("parses standard HTTPS URL with .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/nocoo/signoff.now.git");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "signoff.now",
			});
		});

		test("parses HTTPS URL without .git suffix", () => {
			const result = parseRemoteUrl("https://github.com/nocoo/signoff.now");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "signoff.now",
			});
		});

		test("parses org-owned HTTPS URL", () => {
			const result = parseRemoteUrl(
				"https://github.com/infinity-microsoft/studio.git",
			);
			expect(result).toEqual({
				platform: "github",
				owner: "infinity-microsoft",
				repo: "studio",
			});
		});

		test("parses HTTP URL (upgrades to github platform)", () => {
			const result = parseRemoteUrl("http://github.com/nocoo/repo.git");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "repo",
			});
		});
	});

	describe("SSH GitHub URLs", () => {
		test("parses standard SSH URL", () => {
			const result = parseRemoteUrl("git@github.com:nocoo/repo.git");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "repo",
			});
		});

		test("parses SSH URL without .git suffix", () => {
			const result = parseRemoteUrl("git@github.com:nocoo/repo");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "repo",
			});
		});

		test("parses SSH URL with host alias (gh-work)", () => {
			const result = parseRemoteUrl(
				"git@gh-work:infinity-microsoft/studio.git",
			);
			expect(result).toEqual({
				platform: "github",
				owner: "infinity-microsoft",
				repo: "studio",
			});
		});

		test("parses SSH URL with host alias (gh-personal)", () => {
			const result = parseRemoteUrl("git@gh-personal:nocoo/deca.git");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "deca",
			});
		});

		test("parses SSH URL with dotted repo name", () => {
			const result = parseRemoteUrl("git@gh-personal:nocoo/life.ai.git");
			expect(result).toEqual({
				platform: "github",
				owner: "nocoo",
				repo: "life.ai",
			});
		});
	});

	describe("Azure DevOps URLs", () => {
		test("detects visualstudio.com URL", () => {
			const result = parseRemoteUrl(
				"https://microsoft.visualstudio.com/DefaultCollection/Edge/_git/chromium.src",
			);
			expect(result).toEqual({
				platform: "azure-devops",
				owner: "",
				repo: "",
			});
		});

		test("detects dev.azure.com URL", () => {
			const result = parseRemoteUrl(
				"https://dev.azure.com/microsoft/Edge/_git/chromium.src",
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
