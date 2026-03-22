import { describe, expect, it } from "bun:test";
import {
	getExtension,
	parseKV,
	parseSize,
	splitLines,
	splitNul,
	trimOutput,
} from "./parse.ts";

describe("splitNul", () => {
	it("returns empty array for empty string", () => {
		expect(splitNul("")).toEqual([]);
	});

	it("splits NUL-delimited values", () => {
		expect(splitNul("a\0b\0c\0")).toEqual(["a", "b", "c"]);
	});

	it("handles no trailing NUL", () => {
		expect(splitNul("a\0b")).toEqual(["a", "b"]);
	});

	it("handles single value with NUL", () => {
		expect(splitNul("foo\0")).toEqual(["foo"]);
	});
});

describe("splitLines", () => {
	it("returns empty array for empty string", () => {
		expect(splitLines("")).toEqual([]);
	});

	it("splits newline-delimited output", () => {
		expect(splitLines("a\nb\nc")).toEqual(["a", "b", "c"]);
	});

	it("filters empty lines", () => {
		expect(splitLines("a\n\nb\n")).toEqual(["a", "b"]);
	});
});

describe("parseKV", () => {
	it("parses space-separated key-value", () => {
		expect(parseKV("count: 42")).toEqual({ key: "count:", value: "42" });
	});

	it("parses tab-separated key-value", () => {
		expect(parseKV("key\tvalue")).toEqual({ key: "key", value: "value" });
	});

	it("returns null for single token", () => {
		expect(parseKV("novalue")).toBeNull();
	});

	it("uses custom separator", () => {
		expect(parseKV("key=value", /=/)).toEqual({ key: "key", value: "value" });
	});
});

describe("parseSize", () => {
	it("parses integer string", () => {
		expect(parseSize("1234")).toBe(1234);
	});

	it("parses with trailing text", () => {
		expect(parseSize("42 kilobytes")).toBe(42);
	});

	it("returns 0 for non-numeric", () => {
		expect(parseSize("abc")).toBe(0);
	});
});

describe("getExtension", () => {
	it("extracts extension", () => {
		expect(getExtension("file.ts")).toBe("ts");
	});

	it("extracts extension from path", () => {
		expect(getExtension("src/commands/types.ts")).toBe("ts");
	});

	it("returns (no ext) for no extension", () => {
		expect(getExtension("Makefile")).toBe("(no ext)");
	});

	it("returns (no ext) for dotfile", () => {
		expect(getExtension(".gitignore")).toBe("(no ext)");
	});

	it("lowercases extension", () => {
		expect(getExtension("README.MD")).toBe("md");
	});

	it("handles multiple dots", () => {
		expect(getExtension("file.test.ts")).toBe("ts");
	});
});

describe("trimOutput", () => {
	it("trims trailing whitespace", () => {
		expect(trimOutput("hello  \n")).toBe("hello");
	});

	it("preserves leading whitespace", () => {
		expect(trimOutput("  hello")).toBe("  hello");
	});
});
