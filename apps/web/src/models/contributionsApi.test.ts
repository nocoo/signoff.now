import { contributionFiltersSchema } from "@signoff/domain/insights";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	calculateContribution,
	fetchContribution,
	fetchContributionReport,
} from "./contributionsApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const filters = contributionFiltersSchema.parse({ source: "cli" });
const snapshot = { module: "overview", filters, calculatedAt: 100 };
beforeEach(() => vi.clearAllMocks());

describe("manual statistics transport", () => {
	it("reads a cached module without recalculation and accepts an empty cache", async () => {
		api.mockResolvedValue({ snapshot: null });
		expect(await fetchContribution("overview", filters)).toBeNull();
		expect(api).toHaveBeenCalledWith(
			`/api/insights/overview?filters=${encodeURIComponent(JSON.stringify(filters))}`,
		);
		api.mockResolvedValue({ snapshot });
		expect(await fetchContribution("overview", filters)).toEqual(snapshot);
	});
	it("only a manual POST calculates, preserving the exact filter scope", async () => {
		api.mockResolvedValue({ snapshot });
		expect(await calculateContribution("overview", filters)).toEqual(snapshot);
		expect(api).toHaveBeenCalledWith("/api/insights/overview", {
			method: "POST",
			body: JSON.stringify(filters),
		});
	});
	it("rejects missing or mismatched calculation results and forwards errors", async () => {
		for (const result of [
			null,
			{ ...snapshot, module: "trend" },
			{ ...snapshot, filters: { ...filters, source: "demo" } },
		]) {
			api.mockResolvedValue({ snapshot: result });
			await expect(calculateContribution("overview", filters)).rejects.toThrow(
				"Statistics scope mismatch",
			);
		}
		api.mockResolvedValue({
			snapshot: { ...snapshot, filters: { ...filters, includeDraft: true } },
		});
		await expect(fetchContribution("overview", filters)).rejects.toThrow(
			"Statistics scope mismatch",
		);
		api.mockRejectedValue(new Error("Offline"));
		await expect(fetchContribution("overview", filters)).rejects.toThrow(
			"Offline",
		);
	});
});

describe("cached contribution report transport", () => {
	it("reads the exact report scope with the caller's abort signal", async () => {
		const signal = new AbortController().signal;
		const report = { filters, calculatedAt: 123, contributions: [] };
		api.mockResolvedValue({ report });
		expect(await fetchContributionReport(filters, signal)).toBe(report);
		expect(api).toHaveBeenCalledExactlyOnceWith(
			`/api/insights/report?filters=${encodeURIComponent(JSON.stringify(filters))}`,
			{ signal },
		);
	});
	it.each([
		null,
		undefined,
		{ filters: { ...filters, source: "demo" } },
		{ filters: { ...filters, repositoryKeys: ["other"] } },
	])("rejects missing or mismatched report scopes (%s)", async (report) => {
		api.mockResolvedValue({ report });
		await expect(
			fetchContributionReport(filters, new AbortController().signal),
		).rejects.toThrow("Statistics scope mismatch");
	});
	it("forwards report read failures", async () => {
		api.mockRejectedValue(new Error("Report unavailable"));
		await expect(
			fetchContributionReport(filters, new AbortController().signal),
		).rejects.toThrow("Report unavailable");
	});
});
