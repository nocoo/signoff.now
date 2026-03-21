import { describe, expect, test } from "bun:test";
import {
	type InternalWatchEvent,
	internalToFsWatchEvent,
	internalToSearchPatchEvent,
} from "./watch";

describe("internalToFsWatchEvent", () => {
	test("maps create event", () => {
		const event: InternalWatchEvent = {
			kind: "create",
			absolutePath: "/root/src/new.ts",
			isDirectory: false,
		};
		const result = internalToFsWatchEvent(event);
		expect(result).toEqual({
			kind: "create",
			absolutePath: "/root/src/new.ts",
			oldAbsolutePath: undefined,
		});
	});

	test("maps delete event", () => {
		const event: InternalWatchEvent = {
			kind: "delete",
			absolutePath: "/root/src/old.ts",
			isDirectory: false,
		};
		const result = internalToFsWatchEvent(event);
		expect(result.kind).toBe("delete");
		expect(result.absolutePath).toBe("/root/src/old.ts");
	});

	test("maps rename event with oldAbsolutePath", () => {
		const event: InternalWatchEvent = {
			kind: "rename",
			absolutePath: "/root/src/new.ts",
			oldAbsolutePath: "/root/src/old.ts",
			isDirectory: false,
		};
		const result = internalToFsWatchEvent(event);
		expect(result.kind).toBe("rename");
		expect(result.absolutePath).toBe("/root/src/new.ts");
		expect(result.oldAbsolutePath).toBe("/root/src/old.ts");
	});
});

describe("internalToSearchPatchEvent", () => {
	test("maps create event to search patch event", () => {
		const event: InternalWatchEvent = {
			kind: "create",
			absolutePath: "/root/src/new.ts",
			isDirectory: false,
		};
		const result = internalToSearchPatchEvent(event);
		expect(result).toEqual({
			kind: "create",
			absolutePath: "/root/src/new.ts",
			oldAbsolutePath: undefined,
			isDirectory: false,
		});
	});

	test("returns null for overflow events", () => {
		const event: InternalWatchEvent = {
			kind: "overflow",
			absolutePath: "/root",
			isDirectory: true,
		};
		expect(internalToSearchPatchEvent(event)).toBeNull();
	});

	test("includes isDirectory in output", () => {
		const event: InternalWatchEvent = {
			kind: "create",
			absolutePath: "/root/src/newdir",
			isDirectory: true,
		};
		const result = internalToSearchPatchEvent(event);
		expect(result?.isDirectory).toBe(true);
	});
});
