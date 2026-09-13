import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACTIVITY_WEIGHTS } from "@/models/settings";
import { useSettingsViewModel } from "@/viewmodels/useSettingsViewModel";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/viewmodels/useSettingsViewModel", () => ({
	useSettingsViewModel: vi.fn(),
}));

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.mocked(useSettingsViewModel).mockReturnValue({
			settings: {
				timezone: "Asia/Shanghai",
				emailSuffixes: ["example.com"],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
				pipelineConfigVersion: 1,
				scoresStale: false,
				scoresStaleReason: null,
			},
			form: {
				timezone: "Asia/Shanghai",
				emailSuffixes: [],
				activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
			},
			setForm: vi.fn(),
			loading: false,
			saving: false,
			error: null,
			toast: null,
			setToast: vi.fn(),
			dirty: true,
			validationError: "At least one email suffix is required",
			save: vi.fn(),
			reload: vi.fn(),
		});
	});

	it("shows why saving is disabled and labels inline controls", () => {
		render(<SettingsPage />);

		expect(
			screen.getByText("At least one email suffix is required"),
		).toBeTruthy();
		const saves = screen.getAllByRole("button", { name: "Save changes" });
		expect(saves).toHaveLength(1);
		expect((saves[0] as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByLabelText("Email suffix")).toBeTruthy();
		expect(screen.getByLabelText("PR merged weight")).toBeTruthy();
	});
});
