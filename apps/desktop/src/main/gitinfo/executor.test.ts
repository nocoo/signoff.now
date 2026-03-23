import { describe, expect, test } from "bun:test";
import { createNodeExecutor } from "./executor";

describe("createNodeExecutor", () => {
	const exec = createNodeExecutor();

	test("executes a command and returns stdout", async () => {
		const result = await exec("echo", ["hello"]);
		expect(result.stdout).toBe("hello");
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
	});

	test("returns non-zero exit code without throwing", async () => {
		const result = await exec("sh", ["-c", "exit 42"]);
		expect(result.exitCode).toBe(42);
	});

	test("captures stderr", async () => {
		const result = await exec("sh", ["-c", "echo err >&2"]);
		expect(result.stderr).toBe("err");
		expect(result.exitCode).toBe(0);
	});

	test("supports stdin piping", async () => {
		const result = await exec("cat", [], { stdin: "piped input" });
		expect(result.stdout).toBe("piped input");
		expect(result.exitCode).toBe(0);
	});

	test("supports cwd option", async () => {
		const result = await exec("pwd", [], { cwd: "/tmp" });
		// macOS may resolve /tmp → /private/tmp
		expect(result.stdout).toMatch(/\/tmp$/);
		expect(result.exitCode).toBe(0);
	});

	test("supports env option", async () => {
		const result = await exec("sh", ["-c", "echo $TEST_VAR"], {
			env: { TEST_VAR: "test_value" },
		});
		expect(result.stdout).toBe("test_value");
	});

	test("trims trailing whitespace from stdout and stderr", async () => {
		const result = await exec("printf", ["hello\\n\\n"]);
		expect(result.stdout).toBe("hello");
	});

	test("resolves with exitCode 1 on error (e.g., command not found)", async () => {
		const result = await exec("__nonexistent_command_12345__", []);
		expect(result.exitCode).toBe(1);
	});

	test("handles timeout", async () => {
		const result = await exec("sleep", ["10"], { timeoutMs: 100 });
		// Process killed → non-zero exit
		expect(result.exitCode).not.toBe(0);
	});

	test("handles multiline stdout", async () => {
		const result = await exec("printf", ["line1\\nline2\\nline3"]);
		expect(result.stdout).toBe("line1\nline2\nline3");
	});
});
