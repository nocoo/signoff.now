import { aiScheduleSchema } from "@signoff/domain/ai-readiness";
export async function readAiSchedule(db: D1Database, source: string) {
	const settings = await db
		.prepare(
			"SELECT cooldown_seconds,schedule_revision FROM ai_settings WHERE id=1",
		)
		.first<{ cooldown_seconds: number; schedule_revision: number }>();
	if (!settings) throw new Error("AI schedule is unavailable");
	const { results } = await db
		.prepare(`SELECT p.id,p.name,s.last_started_at,s.last_completed_at,s.last_batch_size,s.input_tokens,s.output_tokens
 FROM projects p LEFT JOIN ai_project_schedule s ON s.project_id=p.id
 WHERE p.source=? AND EXISTS(SELECT 1 FROM pr_observations o WHERE o.project_id=p.id AND o.active=1) ORDER BY p.name,p.id`)
		.bind(source)
		.all<{
			id: string;
			name: string;
			last_started_at: number | null;
			last_completed_at: number | null;
			last_batch_size: number | null;
			input_tokens: number | null;
			output_tokens: number | null;
		}>();
	return aiScheduleSchema.parse({
		revision: settings.schedule_revision,
		cooldownSeconds: settings.cooldown_seconds,
		projects: results.map((p) => ({
			id: p.id,
			name: p.name,
			lastStartedAt: p.last_started_at,
			lastCompletedAt: p.last_completed_at,
			lastBatchSize: p.last_batch_size ?? 0,
			nextEligibleAt:
				p.last_started_at === null
					? null
					: Math.max(p.last_started_at, p.last_completed_at ?? 0) +
						settings.cooldown_seconds,
			inputTokens: p.input_tokens,
			outputTokens: p.output_tokens,
		})),
	});
}
