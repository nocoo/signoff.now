import { useState } from "react";
import {
	loadAiSettings,
	retryAiEvaluations,
	saveAiKey,
	testAiConnection,
} from "@/models/aiSettingsApi";
import { useQueryBlock } from "./useQueryBlock";
export function useAiSettingsViewModel() {
	const settings = useQueryBlock(
		"ai-settings",
		(signal) => loadAiSettings(signal),
		0,
	);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const act = async (kind: "save" | "clear" | "test" | "retry") => {
		if (busy || !settings.data) return;
		setBusy(kind);
		setError(null);
		setNotice(null);
		try {
			if (kind === "save" || kind === "clear") {
				await saveAiKey(
					settings.data.revision,
					kind === "clear" ? null : key.trim(),
				);
				setKey("");
				setNotice(
					kind === "clear"
						? "Jev key cleared."
						: "Jev key saved. Run a connection test to verify it.",
				);
			} else if (kind === "test") {
				await testAiConnection();
				setNotice("Jev connection verified.");
			} else {
				await retryAiEvaluations();
				setNotice("Failed evaluations queued for retry.");
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "AI Settings request failed.");
		} finally {
			await settings.reload();
			setBusy(null);
		}
	};
	return { settings, key, setKey, busy, error, notice, act };
}
