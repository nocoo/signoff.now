import { describe, expect, it } from "bun:test";
import { createBunExecutor } from "../executor/bun-executor.ts";

describe("bun-executor integration", () => {
	const exec = createBunExecutor();

	it("runs git --version successfully", async () => {
		const result = await exec("git", ["--version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^git version \d+/);
		expect(result.stderr).toBe("");
	});

	it("returns non-zero exit code for invalid git command", async () => {
		const result = await exec("git", ["invalid-command-xyz"]);
		expect(result.exitCode).not.toBe(0);
	});

	it("respects cwd option", async () => {
		const result = await exec("pwd", [], { cwd: "/tmp" });
		expect(result.exitCode).toBe(0);
		// /tmp may resolve to /private/tmp on macOS
		expect(result.stdout).toMatch(/tmp$/);
	});
});
