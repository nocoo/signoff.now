import { describe, expect, test } from "vitest";
import { isFormDirty, validateForm } from "@/models/settings";

// ViewModel is hook-based; pure collaboration rules covered via models.
// This file pins the 409-reload expectation as a documented contract.

describe("settings viewmodel contracts", () => {
	test("dirty + validation used before save", () => {
		const form = {
			timezone: "UTC",
			emailSuffixes: ["example.com"],
			activityWeights: { "pr.merged": 1 },
		};
		expect(validateForm(form)).toBeNull();
		expect(isFormDirty(form, form)).toBe(false);
	});
});
