import { aiScheduleSchema } from "@signoff/domain/ai-readiness";
import { nextEligibleAt } from "./decision.js";
export async function readAiSchedule(db: D1Database, source: string) {
	const [settingsResult, projects, pulls] = await db.batch([
		db.prepare(
			"SELECT cooldown_seconds,schedule_revision FROM ai_settings WHERE id=1",
		),
		db
			.prepare(
				`SELECT p.id,p.name,s.last_started_at,s.last_completed_at,s.request_count,s.input_tokens,s.output_tokens FROM projects p LEFT JOIN ai_project_schedule s ON s.project_id=p.id WHERE p.source=? AND EXISTS(SELECT 1 FROM pr_observations o WHERE o.project_id=p.id AND o.active=1) ORDER BY p.name,p.id`,
			)
			.bind(source),
		db
			.prepare(
				`SELECT o.pull_id,e.last_started_at,e.last_completed_at,e.not_before FROM ai_evaluations e JOIN pr_observations o ON o.id=e.observation_id AND o.generation=e.generation WHERE o.active=1 AND o.source=?`,
			)
			.bind(source),
	]);
	const settings = settingsResult?.results[0] as
		| { cooldown_seconds: number; schedule_revision: number }
		| undefined;
	if (!settings) throw new Error("AI schedule is unavailable");
	return aiScheduleSchema.parse({
		revision: settings.schedule_revision,
		cooldownSeconds: settings.cooldown_seconds,
		pulls: (
			pulls?.results as {
				pull_id: string | null;
				last_started_at: number | null;
				last_completed_at: number | null;
				not_before: number;
			}[]
		)
			.filter((p) => p.pull_id)
			.map((p) => ({
				id: p.pull_id,
				nextEligibleAt: nextEligibleAt(p, settings.cooldown_seconds) || null,
			})),
		projects: (
			projects?.results as {
				id: string;
				name: string;
				last_started_at: number | null;
				last_completed_at: number | null;
				request_count: number | null;
				input_tokens: number | null;
				output_tokens: number | null;
			}[]
		).map((p) => ({
			id: p.id,
			name: p.name,
			lastStartedAt: p.last_started_at,
			lastCompletedAt: p.last_completed_at,
			requestCount: p.request_count ?? 0,
			inputTokens: p.input_tokens,
			outputTokens: p.output_tokens,
		})),
	});
}
