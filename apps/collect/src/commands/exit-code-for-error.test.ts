import { describe, expect, test } from "bun:test";
import { AdoError, type AdoErrorKind } from "../ado/client.ts";
import { ExitCode } from "../exit-codes.ts";
import { exitCodeForError } from "./exit-code-for-error.ts";

const code = (kind: AdoErrorKind) => exitCodeForError(new AdoError(kind, kind));

describe("exitCodeForError", () => {
	test("auth problems tell the operator to fix their environment", () => {
		// `az login` expired is not something automation should retry blindly.
		expect(code("unauthenticated")).toBe(ExitCode.ENV);
		expect(code("forbidden")).toBe(ExitCode.ENV);
	});

	test("remote unavailability is retryable", () => {
		expect(code("rate_limited")).toBe(ExitCode.SERVER);
		expect(code("server")).toBe(ExitCode.SERVER);
	});

	test("a bad request or unreadable body is a contract failure", () => {
		expect(code("not_found")).toBe(ExitCode.CONTRACT);
		expect(code("bad_request")).toBe(ExitCode.CONTRACT);
		expect(code("bad_response")).toBe(ExitCode.CONTRACT);
	});

	test("an unnarrowed WIQL result is our bug, not the environment's", () => {
		// Paging bisects on this; reaching the top level means the bisect failed.
		expect(code("result_too_large")).toBe(ExitCode.RUNTIME);
	});

	test("a non-AdoError stays RUNTIME", () => {
		expect(exitCodeForError(new Error("boom"))).toBe(ExitCode.RUNTIME);
		expect(exitCodeForError("string")).toBe(ExitCode.RUNTIME);
		expect(exitCodeForError(undefined)).toBe(ExitCode.RUNTIME);
	});

	test("the whole taxonomy is mapped, and to more than one code", () => {
		// The point of the mapping is that these codes differ. Collapsing them
		// back to a single value passes every test above except this one.
		const all: Record<AdoErrorKind, number> = {
			unauthenticated: ExitCode.ENV,
			forbidden: ExitCode.ENV,
			rate_limited: ExitCode.SERVER,
			server: ExitCode.SERVER,
			not_found: ExitCode.CONTRACT,
			bad_request: ExitCode.CONTRACT,
			bad_response: ExitCode.CONTRACT,
			result_too_large: ExitCode.RUNTIME,
		};
		for (const [kind, expected] of Object.entries(all)) {
			expect(code(kind as AdoErrorKind)).toBe(expected);
		}
		expect(new Set(Object.values(all)).size).toBe(4);
	});
});
