import { describe, expect, test } from "bun:test";
import { dayKey } from "./day-key.js";

describe("dayKey", () => {
	test("Asia/Shanghai crosses UTC midnight", () => {
		// 2026-07-01T16:00:00Z = 2026-07-02 00:00 Asia/Shanghai
		const sec = Math.floor(Date.UTC(2026, 6, 1, 16, 0, 0) / 1000);
		expect(dayKey(sec, "Asia/Shanghai")).toBe("2026-07-02");
	});

	test("UTC same calendar day", () => {
		const sec = Math.floor(Date.UTC(2026, 6, 1, 12, 0, 0) / 1000);
		expect(dayKey(sec, "UTC")).toBe("2026-07-01");
	});

	test("invalid timeZone throws", () => {
		expect(() => dayKey(1_700_000_000, "Not/AZone")).toThrow();
	});

	test("non-positive occurredAt throws", () => {
		expect(() => dayKey(0, "UTC")).toThrow();
	});

	test("empty timeZone throws", () => {
		expect(() => dayKey(1_700_000_000, "")).toThrow();
	});
});
