import { describe, expect, test } from "bun:test";
import { checkAz, type ExecFn } from "./az.ts";

describe("checkAz", () => {
	test("ok when exit 0", async () => {
		const exec: ExecFn = async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ user: { name: "ada@x.com" } }),
			stderr: "",
		});
		const r = await checkAz(exec);
		expect(r.ok).toBe(true);
		expect(r.detail).toBe("ada@x.com");
	});

	test("fail when exit non-zero", async () => {
		const exec: ExecFn = async () => ({
			exitCode: 1,
			stdout: "",
			stderr: "Please run az login",
		});
		const r = await checkAz(exec);
		expect(r.ok).toBe(false);
		expect(r.detail).toMatch(/az login/);
	});

	test("fail when exec throws", async () => {
		const exec: ExecFn = async () => {
			throw new Error("ENOENT");
		};
		const r = await checkAz(exec);
		expect(r.ok).toBe(false);
		expect(r.detail).toBe("ENOENT");
	});

	test("ok with unparseable stdout still logged in", async () => {
		const exec: ExecFn = async () => ({
			exitCode: 0,
			stdout: "not-json",
			stderr: "",
		});
		const r = await checkAz(exec);
		expect(r.ok).toBe(true);
		expect(r.detail).toBe("logged in");
	});
});
