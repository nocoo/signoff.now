import { describe, expect, it } from "vitest";
import { createMockExecutor } from "./mock-executor.ts";
import type { MockResponse } from "./types.ts";

describe("createMockExecutor", () => {
	it("returns configured response for matching command", async () => {
		const responses = new Map<string, MockResponse>([
			["git status", { stdout: "ok", stderr: "warn", exitCode: 0 }],
		]);
		const exec = createMockExecutor(responses);
		const result = await exec("git", ["status"]);
		expect(result).toEqual({ stdout: "ok", stderr: "warn", exitCode: 0 });
	});

	it("defaults stderr and exitCode when omitted", async () => {
		const responses = new Map<string, MockResponse>([
			["git version", { stdout: "git version 2.0" }],
		]);
		const exec = createMockExecutor(responses);
		const result = await exec("git", ["version"]);
		expect(result).toEqual({
			stdout: "git version 2.0",
			stderr: "",
			exitCode: 0,
		});
	});

	it("throws when no mock is configured", async () => {
		const exec = createMockExecutor(new Map());
		await expect(exec("git", ["unknown"])).rejects.toThrow(
			"No mock for: git unknown",
		);
	});
});
