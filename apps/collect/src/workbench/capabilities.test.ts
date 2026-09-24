import { expect, test } from "bun:test";
import type { ExecFn } from "../doctor/az.ts";
import { detectCapabilities } from "./capabilities.ts";

test("reports installed and signed-in tools without requesting login", async () => {
	const calls: string[] = [];
	const exec: ExecFn = async (cmd, args) => {
		calls.push([cmd, ...args].join(" "));
		if (cmd === "gh") throw new Error("ENOENT");
		return { exitCode: 0, stdout: "", stderr: "" };
	};
	expect(await detectCapabilities(exec)).toEqual({
		az: { installed: true, loggedIn: true },
		gh: { installed: false, loggedIn: false },
	});
	expect(calls).toEqual(["az account show --output none", "gh auth status"]);
});

test("an installed tool without a session is not signed in", async () => {
	const exec: ExecFn = async () => ({ exitCode: 1, stdout: "", stderr: "" });
	expect(await detectCapabilities(exec)).toEqual({
		az: { installed: true, loggedIn: false },
		gh: { installed: true, loggedIn: false },
	});
});
