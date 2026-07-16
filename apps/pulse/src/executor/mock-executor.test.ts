import { describe, expect, it } from "vitest";
import { createMockExecutor } from "./mock-executor.ts";
import type { MockResponse } from "./types.ts";

describe("createMockExecutor", () => {
	it("returns configured response for matching command", async () => {
		const responses = new Map<string, MockResponse>([
			["git remote get-url origin", { stdout: "https://github.com/a/b.git" }],
		]);
		const exec = createMockExecutor(responses);
		const result = await exec("git", ["remote", "get-url", "origin"]);
		expect(result).toEqual({
			stdout: "https://github.com/a/b.git",
			stderr: "",
			exitCode: 0,
		});
	});

	it("preserves explicit stderr and exitCode", async () => {
		const responses = new Map<string, MockResponse>([
			["gh auth status", { stdout: "", stderr: "not logged in", exitCode: 1 }],
		]);
		const exec = createMockExecutor(responses);
		const result = await exec("gh", ["auth", "status"]);
		expect(result).toEqual({
			stdout: "",
			stderr: "not logged in",
			exitCode: 1,
		});
	});

	it("throws when no mock is configured", async () => {
		const exec = createMockExecutor(new Map());
		await expect(exec("git", ["status"])).rejects.toThrow(
			"No mock for: git status",
		);
	});
});
