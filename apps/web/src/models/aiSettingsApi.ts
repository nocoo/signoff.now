import { aiSettingsSchema } from "@signoff/domain/ai-readiness";
import { apiFetch } from "@/lib/api";
export const loadAiSettings = async (signal?: AbortSignal) =>
	aiSettingsSchema.parse(await apiFetch("/api/ai/settings", { signal }));
export const saveAiKey = (revision: number, apiKey: string | null) =>
	apiFetch("/api/ai/settings", {
		method: "PUT",
		body: JSON.stringify({ revision, apiKey }),
	});
export const testAiConnection = () =>
	apiFetch("/api/ai/test", { method: "POST" });
export const retryAiEvaluations = () =>
	apiFetch("/api/ai/retry", { method: "POST" });
