import { apiFetch } from "@/lib/api";
import {
	type AppSettings,
	parseSettings,
	type SettingsFormState,
} from "./settings";

export interface SettingsPutResult {
	settings: AppSettings;
	recomputeRequired: boolean;
	recomputeKind: "full_rematch" | "none";
}

export async function fetchSettings(): Promise<AppSettings> {
	const raw = await apiFetch<unknown>("/api/settings");
	return parseSettings(raw);
}

export async function putSettings(
	form: SettingsFormState,
	expectedVersion: number,
): Promise<SettingsPutResult> {
	const raw = await apiFetch<{
		settings: unknown;
		recomputeRequired: boolean;
		recomputeKind: "full_rematch" | "none";
	}>("/api/settings", {
		method: "PUT",
		body: JSON.stringify({
			expectedVersion,
			timezone: form.timezone,
			emailSuffixes: form.emailSuffixes,
			activityWeights: form.activityWeights,
		}),
	});
	return {
		settings: parseSettings(raw.settings),
		recomputeRequired: raw.recomputeRequired,
		recomputeKind: raw.recomputeKind,
	};
}
