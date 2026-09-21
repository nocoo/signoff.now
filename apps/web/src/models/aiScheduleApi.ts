import { type AiTick, aiScheduleSchema } from "@signoff/domain/ai-readiness";
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
export const sendAiPresence = (
	id: string,
	sequence: number,
	source: "cli" | "demo",
	visible: boolean,
) =>
	apiFetch("/api/ai/presence", {
		method: "POST",
		keepalive: true,
		body: JSON.stringify({ id, sequence, source, visible }),
	});
export const tickAi = (view: AiTick, signal: AbortSignal) =>
	apiFetch("/api/ai/tick", {
		method: "POST",
		body: JSON.stringify(view),
		signal,
	});
