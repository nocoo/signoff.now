import { describe, expect, test } from "vitest";
import {
	isFormDirty,
	normalizeSuffixInput,
	parseSettings,
	toFormState,
	validateForm,
} from "./settings";

describe("parseSettings", () => {
	test("parses payload", () => {
		const s = parseSettings({
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { "pr.merged": 10 },
			pipelineConfigVersion: 2,
			scoresStale: true,
			scoresStaleReason: "x",
			updatedAt: { timezone: 1 },
		});
		expect(s.timezone).toBe("UTC");
		expect(s.pipelineConfigVersion).toBe(2);
		expect(s.updatedAt?.timezone).toBe(1);
	});

	test("defaults missing fields", () => {
		const s = parseSettings({});
		expect(s.emailSuffixes).toEqual(["example.com"]);
		expect(s.scoresStaleReason).toBeNull();
	});

	test("throws on non-object", () => {
		expect(() => parseSettings(null)).toThrow(/Invalid/);
	});
});

describe("isFormDirty / validateForm", () => {
	test("dirty detection", () => {
		const a = {
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { "pr.merged": 1 },
		};
		const b = { ...a, timezone: "Asia/Shanghai" };
		expect(isFormDirty(b, a)).toBe(true);
		expect(isFormDirty(a, a)).toBe(false);
	});

	test("validate empty suffixes", () => {
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: [],
				activityWeights: {},
			}),
		).toMatch(/suffix/i);
	});

	test("validate timezone and suffix shape", () => {
		expect(
			validateForm({
				timezone: "  ",
				emailSuffixes: ["ok.com"],
				activityWeights: { a: 1 },
			}),
		).toMatch(/Timezone/i);
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: ["a@b.com"],
				activityWeights: { a: 1 },
			}),
		).toMatch(/suffix/i);
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: ["ok.com"],
				activityWeights: { a: Number.NaN },
			}),
		).toMatch(/weight/i);
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: ["ok.com"],
				activityWeights: { a: 1.5 },
			}),
		).toMatch(/weight/i);
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: ["ok.com"],
				activityWeights: { a: -1 },
			}),
		).toMatch(/weight/i);
		expect(
			validateForm({
				timezone: "UTC",
				emailSuffixes: ["ok.com"],
				activityWeights: { a: 1 },
			}),
		).toBeNull();
	});
});

describe("toFormState / normalizeSuffixInput", () => {
	test("copies arrays", () => {
		const s = parseSettings({
			timezone: "UTC",
			emailSuffixes: ["a.com"],
			activityWeights: {},
			pipelineConfigVersion: 1,
			scoresStale: false,
			scoresStaleReason: null,
		});
		const f = toFormState(s);
		f.emailSuffixes.push("b.com");
		expect(s.emailSuffixes).toEqual(["a.com"]);
	});

	test("normalize suffix", () => {
		expect(normalizeSuffixInput("  Example.COM ")).toBe("example.com");
	});
});
