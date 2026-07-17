import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { DEFAULT_ACTIVITY_WEIGHTS } from "@/models/settings";
import * as settingsApi from "@/models/settingsApi";
import { useSettingsViewModel } from "./useSettingsViewModel";

vi.mock("@/models/settingsApi", () => ({
	fetchSettings: vi.fn(),
	putSettings: vi.fn(),
}));

const sample = {
	timezone: "UTC",
	emailSuffixes: ["example.com"],
	activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
	pipelineConfigVersion: 1,
	scoresStale: false,
	scoresStaleReason: null,
};

beforeEach(() => {
	vi.mocked(settingsApi.fetchSettings).mockReset();
	vi.mocked(settingsApi.putSettings).mockReset();
	vi.mocked(settingsApi.fetchSettings).mockResolvedValue(sample);
	vi.mocked(settingsApi.putSettings).mockResolvedValue({
		settings: sample,
		recomputeRequired: false,
		recomputeKind: "none",
	});
});

describe("useSettingsViewModel", () => {
	test("loads settings on mount", async () => {
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.settings?.timezone).toBe("UTC");
		expect(result.current.form?.timezone).toBe("UTC");
		expect(result.current.error).toBeNull();
	});

	test("sets error on load failure", async () => {
		vi.mocked(settingsApi.fetchSettings).mockRejectedValue(
			new Error("network down"),
		);
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toMatch(/network down/);
		expect(result.current.settings).toBeNull();
	});

	test("save success with recompute toast", async () => {
		vi.mocked(settingsApi.putSettings).mockResolvedValue({
			settings: {
				...sample,
				timezone: "Asia/Shanghai",
				pipelineConfigVersion: 2,
				scoresStale: true,
			},
			recomputeRequired: true,
			recomputeKind: "full_rematch",
		});
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => {
			result.current.setForm({
				timezone: "Asia/Shanghai",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		expect(result.current.dirty).toBe(true);

		await act(async () => {
			await result.current.save();
		});
		expect(result.current.toast).toMatch(/full rematch/i);
		expect(result.current.settings?.pipelineConfigVersion).toBe(2);
	});

	test("save success without recompute", async () => {
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "UTC",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.toast).toMatch(/no changes/i);
	});

	test("save 409 reloads then surfaces conflict message", async () => {
		vi.mocked(settingsApi.fetchSettings)
			.mockResolvedValueOnce(sample)
			.mockResolvedValueOnce({
				...sample,
				pipelineConfigVersion: 3,
				timezone: "Europe/Berlin",
			});
		vi.mocked(settingsApi.putSettings).mockRejectedValue(
			new ApiError("conflict", 409),
		);
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "Asia/Tokyo",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		await waitFor(() =>
			expect(result.current.settings?.pipelineConfigVersion).toBe(3),
		);
		// Form replaced with server state; error explains why (not cleared by reload)
		expect(result.current.form?.timezone).toBe("Europe/Berlin");
		expect(result.current.error).toMatch(/version conflict/i);
		expect(result.current.error).toMatch(/loaded latest/i);
		expect(result.current.dirty).toBe(false);
		expect(
			vi.mocked(settingsApi.fetchSettings).mock.calls.length,
		).toBeGreaterThanOrEqual(2);
	});

	test("save generic error", async () => {
		vi.mocked(settingsApi.putSettings).mockRejectedValue(new Error("boom"));
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "Asia/Tokyo",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).toMatch(/boom/);
	});

	test("validation error blocks save", async () => {
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "UTC",
				emailSuffixes: [],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).toMatch(/suffix/i);
		expect(settingsApi.putSettings).not.toHaveBeenCalled();
	});

	test("save no-ops while still loading", async () => {
		let resolveFetch: (v: typeof sample) => void = () => {};
		vi.mocked(settingsApi.fetchSettings).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const { result } = renderHook(() => useSettingsViewModel());
		await act(async () => {
			await result.current.save();
		});
		expect(settingsApi.putSettings).not.toHaveBeenCalled();
		await act(async () => {
			resolveFetch(sample);
		});
		await waitFor(() => expect(result.current.loading).toBe(false));
	});

	test("save 409 with duck-typed status object", async () => {
		vi.mocked(settingsApi.fetchSettings)
			.mockResolvedValueOnce(sample)
			.mockResolvedValueOnce({ ...sample, pipelineConfigVersion: 4 });
		vi.mocked(settingsApi.putSettings).mockRejectedValue({
			status: 409,
			message: "conflict",
		});
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "Asia/Tokyo",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		await waitFor(() =>
			expect(result.current.settings?.pipelineConfigVersion).toBe(4),
		);
		expect(result.current.error).toMatch(/version conflict/i);
	});

	test("save 409 keeps reload error when re-fetch fails", async () => {
		vi.mocked(settingsApi.fetchSettings)
			.mockResolvedValueOnce(sample)
			.mockRejectedValueOnce(new Error("reload failed"));
		vi.mocked(settingsApi.putSettings).mockRejectedValue(
			new ApiError("conflict", 409),
		);
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "Asia/Tokyo",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		await waitFor(() => expect(result.current.error).toMatch(/reload failed/));
		// Do not overwrite reload failure with the conflict-success copy
		expect(result.current.error).not.toMatch(/loaded latest/i);
	});

	test("save non-Error rejection", async () => {
		vi.mocked(settingsApi.putSettings).mockRejectedValue("nope");
		const { result } = renderHook(() => useSettingsViewModel());
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => {
			result.current.setForm({
				timezone: "Asia/Tokyo",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			});
		});
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).toBe("Save failed");
	});
});
