import { describe, expect, test } from "bun:test";
import { dayKey } from "./day-key.js";

describe("dayKey", () => {
	test("B16: Asia/Shanghai crosses UTC midnight", () => {
		// 2026-07-01T16:00:00Z = 2026-07-02 00:00 Asia/Shanghai
		const sec = Math.floor(Date.UTC(2026, 6, 1, 16, 0, 0) / 1000);
		expect(dayKey(sec, "Asia/Shanghai")).toBe("2026-07-02");
	});

	test("B16: UTC same calendar day", () => {
		const sec = Math.floor(Date.UTC(2026, 6, 1, 12, 0, 0) / 1000);
		expect(dayKey(sec, "UTC")).toBe("2026-07-01");
	});

	test("B16: negative-offset zone stays on the previous day", () => {
		// 2026-07-02T03:00:00Z is still 2026-07-01 in America/Los_Angeles.
		const sec = Math.floor(Date.UTC(2026, 6, 2, 3, 0, 0) / 1000);
		expect(dayKey(sec, "America/Los_Angeles")).toBe("2026-07-01");
	});

	test("B16: en-CA formatting is locale-independent (not IANA-as-locale)", () => {
		// Guards the §3.5 decision: a zero-padded ISO day key regardless of the
		// host's default locale.
		const sec = Math.floor(Date.UTC(2026, 0, 5, 2, 0, 0) / 1000);
		expect(dayKey(sec, "Asia/Shanghai")).toBe("2026-01-05");
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
