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

		test("parses --state merged", () => {
			expect(parseArgs(["prs", "--state", "merged"]).state).toBe("merged");
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

	describe("pr show command", () => {
		test("parses pr show command", () => {
			expect(parseArgs(["pr", "show"]).command).toBe("pr show");
		});

		test("parses --number flag", () => {
			const result = parseArgs(["pr", "show", "--number", "42"]);
			expect(result.command).toBe("pr show");
			expect(result.number).toBe(42);
		});

		test("defaults number to null", () => {
			expect(parseArgs([]).number).toBeNull();
		});

		test("throws on --number without value", () => {
			expect(() => parseArgs(["pr", "show", "--number"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --number with non-number", () => {
			expect(() => parseArgs(["pr", "show", "--number", "abc"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --number with decimal", () => {
			expect(() => parseArgs(["pr", "show", "--number", "1.5"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on --number with zero", () => {
			expect(() => parseArgs(["pr", "show", "--number", "0"])).toThrow(
				ArgParseError,
			);
		});

		test("throws on pr without sub-action", () => {
			expect(() => parseArgs(["pr"])).toThrow(ArgParseError);
		});

		test("throws on pr with invalid sub-action", () => {
			expect(() => parseArgs(["pr", "invalid"])).toThrow(ArgParseError);
		});

		test("parses flags before pr show", () => {
			const result = parseArgs(["--pretty", "pr", "show", "--number", "7"]);
			expect(result.pretty).toBe(true);
			expect(result.command).toBe("pr show");
			expect(result.number).toBe(7);
		});
	});
});

describe("getHelpText", () => {
	test("returns non-empty help text", () => {
		const text = getHelpText();
		expect(text).toContain("pulse");
		expect(text).toContain("prs");
		expect(text).toContain("pr show");
		expect(text).toContain("--state");
		expect(text).toContain("--number");
	});
});
