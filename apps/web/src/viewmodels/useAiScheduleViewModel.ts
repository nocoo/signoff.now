import { useState } from "react";
import { loadAiSchedule, saveAiCooldown } from "@/models/aiScheduleApi";
import { useQueryBlock } from "./useQueryBlock";
export function useAiScheduleViewModel(source: "cli" | "demo") {
	const query = useQueryBlock(
		`ai-schedule:${source}`,
		(signal) => loadAiSchedule(source, signal),
		3000,
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async (seconds: number) => {
		if (!query.data || saving) return;
		setSaving(true);
		setError(null);
		try {
			await saveAiCooldown(query.data.revision, seconds);
			await query.reload();
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Unable to save AI cooldown",
			);
		} finally {
			setSaving(false);
		}
	};
	return { ...query, saving, mutationError: error, save };
}
