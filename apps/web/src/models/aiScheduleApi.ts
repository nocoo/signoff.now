import { aiScheduleSchema } from "@signoff/domain/ai-readiness";
import { apiFetch } from "@/lib/api";
export const loadAiSchedule = async (
	source: "cli" | "demo",
	signal?: AbortSignal,
) =>
	aiScheduleSchema.parse(
		await apiFetch(`/api/ai/schedule?source=${source}`, { signal }),
	);
export const saveAiCooldown = (revision: number, cooldownSeconds: number) =>
	apiFetch("/api/ai/schedule", {
		method: "PUT",
		body: JSON.stringify({ revision, cooldownSeconds }),
	});
