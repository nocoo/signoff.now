import { describe, expect, test } from "bun:test";
import { checkAz, type ExecFn } from "./az.ts";

describe("checkAz", () => {
	test("checks an ADO token rather than a cached account record", async () => {
		const calls: string[][] = [];
		const exec: ExecFn = async (_command, args) => {
			calls.push(args);
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					accessToken: "private-token",
					expires_on: Math.floor(Date.now() / 1000) + 3600,
				}),
				stderr: "",
			};
		};
		const r = await checkAz(exec);
		expect(r.ok).toBe(true);
		expect(r.detail).toContain("valid");
		expect(r.detail).not.toContain("private-token");
		expect(calls[0]).toContain("get-access-token");
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
		expect(r.detail).toContain("Azure CLI");
	});

	test("malformed token output cannot claim login is valid", async () => {
		const exec: ExecFn = async () => ({
			exitCode: 0,
			stdout: "not-json",
			stderr: "",
		});
		const r = await checkAz(exec);
		expect(r.ok).toBe(false);
	});
});
