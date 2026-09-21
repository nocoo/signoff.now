import { aiRulesSchema, aiSettingsSchema } from "@signoff/domain/ai-readiness";
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

export const loadAiRules = async (signal?: AbortSignal) =>
	aiRulesSchema.parse(await apiFetch("/api/ai/rules", { signal }));
export const saveAiRule = (scope: string, revision: number, text: string) =>
	apiFetch("/api/ai/rules", {
		method: "PUT",
		body: JSON.stringify({ scope, revision, text }),
	});
