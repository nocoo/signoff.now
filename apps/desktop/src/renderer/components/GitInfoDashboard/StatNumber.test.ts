/**
 * Tests for GitInfoDashboard utility functions.
 */

import { describe, expect, test } from "bun:test";
import {
	formatBytes,
	formatNumber,
	formatSize,
	relativeDate,
} from "./StatNumber";

describe("formatNumber", () => {
	test("formats millions", () => {
		expect(formatNumber(1_500_000)).toBe("1.5M");
	});

	test("formats thousands", () => {
		expect(formatNumber(15_000)).toBe("15.0K");
	});

	test("formats small numbers with locale", () => {
		expect(formatNumber(999)).toBe("999");
	});

	test("formats 10K boundary", () => {
		expect(formatNumber(10_000)).toBe("10.0K");
	});
});

describe("formatSize", () => {
	test("formats gigabytes", () => {
		expect(formatSize(1_048_576)).toBe("1.0 GB");
	});

	test("formats megabytes", () => {
		expect(formatSize(1024)).toBe("1.0 MB");
	});

	test("formats kilobytes", () => {
		expect(formatSize(512)).toBe("512 KB");
	});
});

describe("formatBytes", () => {
	test("formats gigabytes", () => {
		expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
	});

	test("formats megabytes", () => {
		expect(formatBytes(1_048_576)).toBe("1.0 MB");
	});

	test("formats kilobytes", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
	});

	test("formats bytes", () => {
		expect(formatBytes(512)).toBe("512 B");
	});
});

describe("relativeDate", () => {
	test("returns 'just now' for recent dates", () => {
		const now = new Date().toISOString();
		expect(relativeDate(now)).toBe("just now");
	});

	test("returns minutes ago", () => {
		const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
		expect(relativeDate(fiveMinAgo)).toBe("5m ago");
	});

	test("returns hours ago", () => {
		const threeHrsAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
		expect(relativeDate(threeHrsAgo)).toBe("3h ago");
	});

	test("returns days ago", () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
		expect(relativeDate(tenDaysAgo)).toBe("10d ago");
	});

	test("returns months ago", () => {
		const threeMonthsAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
		expect(relativeDate(threeMonthsAgo)).toBe("3mo ago");
	});

	test("returns years ago", () => {
		const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString();
		expect(relativeDate(twoYearsAgo)).toBe("2y ago");
	});
});
