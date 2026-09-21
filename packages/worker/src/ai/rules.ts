import {
	aiRulesSchema,
	COMMON_RULES,
	defaultProjectRules,
} from "@signoff/domain/ai-readiness";
export async function readAiRules(db: D1Database) {
	const [rules, projects] = await db.batch([
		db.prepare("SELECT * FROM ai_rules"),
		db.prepare(
			"SELECT id,name FROM projects WHERE source='cli' ORDER BY name,id",
		),
	]);
	const saved = rules?.results as {
		scope: string;
		revision: number;
		text: string;
	}[];
	const common = saved.find((r) => r.scope === "common");
	return aiRulesSchema.parse({
		common: common ?? { revision: 0, text: COMMON_RULES },
		projects: (projects?.results as { id: string; name: string }[]).map(
			(p) => ({
				...p,
				revision: 0,
				text: defaultProjectRules(p.id as string),
				...saved.find((r) => r.scope === p.id),
			}),
		),
	});
}
