import { describe, expect, test } from "bun:test";
import { ExitCode } from "../exit-codes.ts";
import { validateCollectFlags } from "./collect-flags.ts";

describe("validateCollectFlags", () => {
	test("--full alone is allowed", () => {
		expect(validateCollectFlags({ full: true })).toEqual({ ok: true });
		expect(validateCollectFlags({ full: true, wi: true })).toEqual({
			ok: true,
		});
	});

	test("a scoped run without --full is allowed", () => {
		expect(validateCollectFlags({ repo: "r1" })).toEqual({ ok: true });
		expect(validateCollectFlags({ repo: "r1", wi: false })).toEqual({
			ok: true,
		});
		expect(validateCollectFlags({})).toEqual({ ok: true });
	});

	test("--full --repo is refused", () => {
		// --full clears scores_stale globally. Collecting one repo and then
		// declaring every score fresh silently freezes everyone else's numbers.
		const r = validateCollectFlags({ full: true, repo: "r1" });
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ code: ExitCode.CONTRACT });
		expect(r.ok === false && r.error).toMatch(/--full/);
	});

	test("--full --no-wi is refused", () => {
		// Same failure, other axis: work-item scores would stay stale while the
		// run reports a complete recompute.
		const r = validateCollectFlags({ full: true, wi: false });
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ code: ExitCode.CONTRACT });
		expect(r.ok === false && r.error).toMatch(/work items/);
	});

	test("both violations at once still refuse", () => {
		expect(validateCollectFlags({ full: true, repo: "r1", wi: false }).ok).toBe(
			false,
		);
	});

	test("--since is orthogonal to the guards", () => {
		expect(validateCollectFlags({ full: true, since: "2026-01-01" })).toEqual({
			ok: true,
		});
	});
});
