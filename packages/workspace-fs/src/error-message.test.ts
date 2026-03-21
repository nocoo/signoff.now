import { describe, expect, test } from "bun:test";
import { toErrorMessage } from "./error-message";

describe("toErrorMessage", () => {
	test("returns .message from an Error instance", () => {
		expect(toErrorMessage(new Error("something broke"))).toBe(
			"something broke",
		);
	});

	test("returns stringified message from an object with a message property", () => {
		expect(toErrorMessage({ message: "custom error" })).toBe("custom error");
	});

	test("stringifies a non-string message property", () => {
		expect(toErrorMessage({ message: 42 })).toBe("42");
	});

	test("returns the string itself for a primitive string", () => {
		expect(toErrorMessage("plain string")).toBe("plain string");
	});

	test("returns 'null' for null", () => {
		expect(toErrorMessage(null)).toBe("null");
	});

	test("returns 'undefined' for undefined", () => {
		expect(toErrorMessage(undefined)).toBe("undefined");
	});

	test("returns stringified number for a number", () => {
		expect(toErrorMessage(123)).toBe("123");
	});
});
