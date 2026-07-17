import { describe, expect, test } from "bun:test";
import {
	DEFAULT_ACTIVITY_WEIGHTS,
	diffBusiness,
	normalizeActivityWeights,
	normalizeEmailSuffixes,
	parseBusinessInput,
	rowsToAppSettings,
	validateTimezone,
} from "./settings.js";

describe("normalizeEmailSuffixes", () => {
	test("lowercases and dedupes", () => {
		expect(
			normalizeEmailSuffixes([
				"Example.COM",
				"example.com",
				"corp.example.com",
			]),
		).toEqual(["example.com", "corp.example.com"]);
	});

	test("rejects empty or email-like", () => {
		expect(normalizeEmailSuffixes([])).toBeNull();
		expect(normalizeEmailSuffixes(["a@b.com"])).toBeNull();
	});
});

describe("normalizeActivityWeights", () => {
	test("fills defaults", () => {
		const w = normalizeActivityWeights({ "pr.merged": 99 });
		expect(w?.["pr.merged"]).toBe(99);
		expect(w?.["wi.closed"]).toBe(DEFAULT_ACTIVITY_WEIGHTS["wi.closed"]);
	});

	test("rejects non-numbers", () => {
		expect(normalizeActivityWeights({ "pr.merged": "x" })).toBeNull();
	});
});

describe("validateTimezone", () => {
	test("accepts IANA", () => {
		expect(validateTimezone("Asia/Shanghai")).toBe("Asia/Shanghai");
	});
	test("rejects garbage", () => {
		expect(validateTimezone("Not/AZone")).toBeNull();
	});
});

describe("rowsToAppSettings", () => {
	test("parses seed-like rows", () => {
		const s = rowsToAppSettings([
			{ key: "timezone", value: '"UTC"', updated_at: 1 },
			{ key: "email_suffixes", value: '["example.com"]', updated_at: 2 },
			{
				key: "activity_weights",
				value: JSON.stringify(DEFAULT_ACTIVITY_WEIGHTS),
				updated_at: 3,
			},
			{ key: "pipeline_config_version", value: "2", updated_at: 4 },
			{ key: "scores_stale", value: "true", updated_at: 5 },
			{
				key: "scores_stale_reason",
				value: '"timezone updated"',
				updated_at: 6,
			},
		]);
		expect(s.timezone).toBe("UTC");
		expect(s.pipelineConfigVersion).toBe(2);
		expect(s.scoresStale).toBe(true);
		expect(s.scoresStaleReason).toBe("timezone updated");
	});
});

describe("parseBusinessInput", () => {
	test("requires expectedVersion", () => {
		const r = parseBusinessInput({
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
		});
		expect(r.ok).toBe(false);
	});

	test("accepts valid body", () => {
		const r = parseBusinessInput({
			expectedVersion: 1,
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.expectedVersion).toBe(1);
		}
	});
});

describe("diffBusiness", () => {
	const base = rowsToAppSettings([
		{ key: "timezone", value: '"UTC"', updated_at: 1 },
		{ key: "email_suffixes", value: '["example.com"]', updated_at: 1 },
		{
			key: "activity_weights",
			value: JSON.stringify(DEFAULT_ACTIVITY_WEIGHTS),
			updated_at: 1,
		},
		{ key: "pipeline_config_version", value: "1", updated_at: 1 },
		{ key: "scores_stale", value: "false", updated_at: 1 },
		{ key: "scores_stale_reason", value: "null", updated_at: 1 },
	]);

	test("none when equal", () => {
		const d = diffBusiness(base, {
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
		});
		expect(d.recomputeKind).toBe("none");
		expect(d.changed).toBe(false);
	});

	test("full_rematch on timezone", () => {
		const d = diffBusiness(base, {
			timezone: "Asia/Shanghai",
			emailSuffixes: ["example.com"],
			activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
		});
		expect(d.recomputeKind).toBe("full_rematch");
		expect(d.timezoneChanged).toBe(true);
	});

	test("full_rematch on suffixes and weights", () => {
		const s = diffBusiness(base, {
			timezone: "UTC",
			emailSuffixes: ["corp.example.com"],
			activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
		});
		expect(s.suffixesChanged).toBe(true);
		expect(s.reason).toContain("email_suffixes");
		const w = diffBusiness(base, {
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS, "pr.merged": 99 },
		});
		expect(w.weightsChanged).toBe(true);
	});
});

describe("parseBusinessInput branches", () => {
	test("invalid payload types", () => {
		expect(parseBusinessInput(null).ok).toBe(false);
		expect(
			parseBusinessInput({
				expectedVersion: 1.5,
				timezone: "UTC",
				emailSuffixes: ["example.com"],
				activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
			}).ok,
		).toBe(false);
		expect(
			parseBusinessInput({
				expectedVersion: 1,
				timezone: "Not/AZone",
				emailSuffixes: ["example.com"],
				activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
			}).ok,
		).toBe(false);
		expect(
			parseBusinessInput({
				expectedVersion: 1,
				timezone: "UTC",
				emailSuffixes: ["a@b.com"],
				activityWeights: DEFAULT_ACTIVITY_WEIGHTS,
			}).ok,
		).toBe(false);
		expect(
			parseBusinessInput({
				expectedVersion: 1,
				timezone: "UTC",
				emailSuffixes: ["example.com"],
				activityWeights: { "pr.merged": "x" },
			}).ok,
		).toBe(false);
	});
});

describe("normalizeEmailSuffixes edge", () => {
	test("rejects non-string element and blank", () => {
		expect(normalizeEmailSuffixes([1])).toBeNull();
		expect(normalizeEmailSuffixes(["  "])).toBeNull();
	});
});

describe("normalizeActivityWeights edge", () => {
	test("rejects array", () => {
		expect(normalizeActivityWeights([])).toBeNull();
	});
});
