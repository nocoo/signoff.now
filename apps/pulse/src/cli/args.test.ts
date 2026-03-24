import { describe, expect, test } from "bun:test";
import { ArgParseError, getHelpText, parseArgs } from "./args.ts";

describe("parseArgs", () => {
	test("parses empty args", () => {
		const result = parseArgs([]);
		expect(result.command).toBeNull();
		expect(result.help).toBe(false);
		expect(result.version).toBe(false);
		expect(result.pretty).toBe(false);
		expect(result.state).toBe("open");
		expect(result.limit).toBe(0);
		expect(result.author).toBeNull();
	});

	test("parses --help flag", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
	});

	test("parses --version flag", () => {
		expect(parseArgs(["--version"]).version).toBe(true);
		expect(parseArgs(["-v"]).version).toBe(true);
	});

	test("parses --pretty flag", () => {
		expect(parseArgs(["--pretty"]).pretty).toBe(true);
	});

	test("parses --no-cache flag", () => {
		expect(parseArgs(["--no-cache"]).noCache).toBe(true);
	});

	test("parses --cwd with path", () => {
		expect(parseArgs(["--cwd", "/tmp/repo"]).cwd).toBe("/tmp/repo");
	});

	test("throws on --cwd without path", () => {
		expect(() => parseArgs(["--cwd"])).toThrow(ArgParseError);
	});

	test("throws on --cwd with flag as value", () => {
		expect(() => parseArgs(["--cwd", "--help"])).toThrow(ArgParseError);
	});

	test("parses prs command", () => {
		expect(parseArgs(["prs"]).command).toBe("prs");
	});

	test("throws on unknown command", () => {
		expect(() => parseArgs(["unknown"])).toThrow(ArgParseError);
	});

	test("throws on duplicate commands", () => {
		expect(() => parseArgs(["prs", "prs"])).toThrow(ArgParseError);
	});

	test("throws on unknown flag", () => {
		expect(() => parseArgs(["--foo"])).toThrow(ArgParseError);
	});

	describe("prs flags", () => {
		test("parses --state open", () => {
			expect(parseArgs(["prs", "--state", "open"]).state).toBe("open");
		});

		test("parses --state closed", () => {
			expect(parseArgs(["prs", "--state", "closed"]).state).toBe("closed");
		});

		test("parses --state all", () => {
			expect(parseArgs(["prs", "--state", "all"]).state).toBe("all");
		});

		test("throws on invalid --state", () => {
			expect(() => parseArgs(["prs", "--state", "invalid"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --state without value", () => {
			expect(() => parseArgs(["prs", "--state"])).toThrow(ArgParseError);
		});

		test("parses --limit", () => {
			expect(parseArgs(["prs", "--limit", "10"]).limit).toBe(10);
		});

		test("throws on --limit without number", () => {
			expect(() => parseArgs(["prs", "--limit"])).toThrow(ArgParseError);
		});

		test("throws on --limit with negative", () => {
			expect(() => parseArgs(["prs", "--limit", "-1"])).toThrow(ArgParseError);
		});

		test("throws on --limit with non-number", () => {
			expect(() => parseArgs(["prs", "--limit", "abc"])).toThrow(ArgParseError);
		});

		test("throws on --limit with trailing garbage", () => {
			expect(() => parseArgs(["prs", "--limit", "1foo"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --limit with decimal", () => {
			expect(() => parseArgs(["prs", "--limit", "1.5"])).toThrow(ArgParseError);
		});

		test("parses --author", () => {
			expect(parseArgs(["prs", "--author", "alice"]).author).toBe("alice");
		});

		test("throws on --author without value", () => {
			expect(() => parseArgs(["prs", "--author"])).toThrow(ArgParseError);
		});

		test("throws on --author with flag as value", () => {
			expect(() => parseArgs(["prs", "--author", "--pretty"])).toThrow(
				ArgParseError,
			);
		});
	});

	test("parses combined args", () => {
		const result = parseArgs([
			"prs",
			"--state",
			"all",
			"--limit",
			"5",
			"--author",
			"alice",
			"--pretty",
			"--no-cache",
		]);
		expect(result.command).toBe("prs");
		expect(result.state).toBe("all");
		expect(result.limit).toBe(5);
		expect(result.author).toBe("alice");
		expect(result.pretty).toBe(true);
		expect(result.noCache).toBe(true);
	});

	test("parses flags before command", () => {
		const result = parseArgs(["--pretty", "prs"]);
		expect(result.pretty).toBe(true);
		expect(result.command).toBe("prs");
	});

	describe("pr-detail command", () => {
		test("parses pr-detail command", () => {
			expect(parseArgs(["pr-detail"]).command).toBe("pr-detail");
		});

		test("parses --pr flag", () => {
			const result = parseArgs(["pr-detail", "--pr", "42"]);
			expect(result.command).toBe("pr-detail");
			expect(result.pr).toBe(42);
		});

		test("defaults pr to null", () => {
			expect(parseArgs([]).pr).toBeNull();
		});

		test("throws on --pr without number", () => {
			expect(() => parseArgs(["pr-detail", "--pr"])).toThrow(ArgParseError);
		});

		test("throws on --pr with non-number", () => {
			expect(() => parseArgs(["pr-detail", "--pr", "abc"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --pr with decimal", () => {
			expect(() => parseArgs(["pr-detail", "--pr", "1.5"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --pr with zero", () => {
			expect(() => parseArgs(["pr-detail", "--pr", "0"])).toThrow(
				ArgParseError,
			);
		});
	});
});

describe("getHelpText", () => {
	test("returns non-empty help text", () => {
		const text = getHelpText();
		expect(text).toContain("pulse");
		expect(text).toContain("prs");
		expect(text).toContain("pr-detail");
		expect(text).toContain("--state");
		expect(text).toContain("--pr");
	});
});
