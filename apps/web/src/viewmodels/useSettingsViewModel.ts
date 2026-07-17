import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import {
	type AppSettings,
	isFormDirty,
	type SettingsFormState,
	toFormState,
	validateForm,
} from "@/models/settings";
import { fetchSettings, putSettings } from "@/models/settingsApi";

export function useSettingsViewModel() {
	const [settings, setSettings] = useState<AppSettings | null>(null);
	const [form, setForm] = useState<SettingsFormState | null>(null);
	const [baseline, setBaseline] = useState<SettingsFormState | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const s = await fetchSettings();
			setSettings(s);
			const f = toFormState(s);
			setForm(f);
			setBaseline(f);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load settings");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const dirty = useMemo(() => {
		if (!form || !baseline) {
			return false;
		}
		return isFormDirty(form, baseline);
	}, [form, baseline]);

	const validationError = useMemo(
		() => (form ? validateForm(form) : null),
		[form],
	);

	const save = useCallback(async () => {
		if (!form || !settings) {
			return;
		}
		const v = validateForm(form);
		if (v) {
			setError(v);
			return;
		}
		setSaving(true);
		setError(null);
		setToast(null);
		try {
			const result = await putSettings(form, settings.pipelineConfigVersion);
			setSettings(result.settings);
			const f = toFormState(result.settings);
			setForm(f);
			setBaseline(f);
			if (result.recomputeRequired) {
				setToast(
					`Saved. Config v${result.settings.pipelineConfigVersion} — full rematch required.`,
				);
			} else {
				setToast("Saved (no changes affecting scores).");
			}
		} catch (e) {
			const status =
				e instanceof ApiError
					? e.status
					: e && typeof e === "object" && "status" in e
						? Number((e as { status: unknown }).status)
						: undefined;
			if (status === 409) {
				setError("Version conflict — reloading latest settings.");
				await reload();
			} else {
				setError(e instanceof Error ? e.message : "Save failed");
			}
		} finally {
			setSaving(false);
		}
	}, [form, settings, reload]);

	return {
		settings,
		form,
		setForm,
		loading,
		saving,
		error,
		toast,
		setToast,
		dirty,
		validationError,
		save,
		reload,
	};
}
