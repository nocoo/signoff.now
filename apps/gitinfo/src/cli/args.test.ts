import { describe, expect, it } from "bun:test";
import { ArgParseError, parseArgs } from "./args.ts";

describe("parseArgs", () => {
	it("parses empty args", () => {
		const result = parseArgs([]);
		expect(result).toEqual({
			section: null,
			full: false,
			pretty: false,
			cwd: null,
			help: false,
			version: false,
		});
	});

	it("parses --help flag", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
	});

	it("parses --version flag", () => {
		expect(parseArgs(["--version"]).version).toBe(true);
		expect(parseArgs(["-v"]).version).toBe(true);
	});

	it("parses --full flag", () => {
		expect(parseArgs(["--full"]).full).toBe(true);
	});

	it("parses --pretty flag", () => {
		expect(parseArgs(["--pretty"]).pretty).toBe(true);
	});

	it("parses --cwd with path", () => {
		const result = parseArgs(["--cwd", "/tmp/repo"]);
		expect(result.cwd).toBe("/tmp/repo");
	});

	it("throws on --cwd without path", () => {
		expect(() => parseArgs(["--cwd"])).toThrow(ArgParseError);
	});

	it("throws on --cwd with flag as value", () => {
		expect(() => parseArgs(["--cwd", "--full"])).toThrow(ArgParseError);
	});

	it("parses valid section", () => {
		expect(parseArgs(["meta"]).section).toBe("meta");
		expect(parseArgs(["branches"]).section).toBe("branches");
		expect(parseArgs(["status"]).section).toBe("status");
		expect(parseArgs(["logs"]).section).toBe("logs");
		expect(parseArgs(["contributors"]).section).toBe("contributors");
		expect(parseArgs(["tags"]).section).toBe("tags");
		expect(parseArgs(["files"]).section).toBe("files");
		expect(parseArgs(["config"]).section).toBe("config");
	});

	it("throws on unknown section", () => {
		expect(() => parseArgs(["unknown"])).toThrow(ArgParseError);
	});

	it("throws on duplicate sections", () => {
		expect(() => parseArgs(["meta", "logs"])).toThrow(ArgParseError);
	});

	it("throws on unknown flag", () => {
		expect(() => parseArgs(["--unknown"])).toThrow(ArgParseError);
	});

	it("parses combined args", () => {
		const result = parseArgs([
			"contributors",
			"--full",
			"--pretty",
			"--cwd",
			"/tmp",
		]);
		expect(result).toEqual({
			section: "contributors",
			full: true,
			pretty: true,
			cwd: "/tmp",
			help: false,
			version: false,
		});
	});

	it("parses flags before section", () => {
		const result = parseArgs(["--pretty", "meta"]);
		expect(result.section).toBe("meta");
		expect(result.pretty).toBe(true);
	});
});
