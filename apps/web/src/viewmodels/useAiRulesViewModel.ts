import { useState } from "react";
import { loadAiRules, saveAiRule } from "@/models/aiSettingsApi";
import { useQueryBlock } from "./useQueryBlock";
export function useAiRulesViewModel() {
	const rules = useQueryBlock("ai-rules", (signal) => loadAiRules(signal), 0);
	const [scope, setScope] = useState("common");
	const [draft, setDraft] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const current =
		scope === "common"
			? rules.data?.common
			: rules.data?.projects.find((p) => p.id === scope);
	return {
		rules,
		scope,
		current,
		text: draft ?? current?.text ?? "",
		busy,
		message,
		select: (value: string) => {
			setScope(value);
			setDraft(null);
			setMessage("");
		},
		edit: setDraft,
		save: async () => {
			if (!current || busy) return;
			setBusy(true);
			setMessage("");
			try {
				await saveAiRule(scope, current.revision, draft ?? current.text);
				await rules.reload();
				setDraft(null);
				setMessage(
					"Rules saved. Affected watched PRs will be evaluated when foreground and eligible.",
				);
			} catch (e) {
				setMessage(e instanceof Error ? e.message : "Cannot save rules.");
			} finally {
				setBusy(false);
			}
		},
	};
}
