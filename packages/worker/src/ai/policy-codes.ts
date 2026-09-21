import { POLICY_CODES } from "@signoff/domain/ai-readiness";
export async function numberPolicies(
	db: D1Database,
	projectId: string,
	gates: { id: string; name?: string; sourceIds?: string[] }[],
) {
	const codes = new Map<string, string>();
	const records = await db
		.prepare(
			"SELECT a.gate_id,p.id,p.code FROM ai_policy_aliases a JOIN ai_policy_codes p ON p.id=a.policy_id WHERE a.project_id=?",
		)
		.bind(projectId)
		.all<{ gate_id: string; id: number; code: string | null }>();
	const known = new Map(records.results.map((r) => [r.gate_id, r]));
	for (const r of records.results) codes.set(r.gate_id, r.code ?? `P${r.id}`);
	for (const gate of new Map(gates.map((g) => [g.id, g])).values()) {
		if (gate.id === "merge-conflicts") {
			codes.set(gate.id, "C1");
			continue;
		}
		const aliases = [gate.id, ...(gate.sourceIds ?? [])];
		let saved: { id: number; code: string | null } | undefined = aliases
			.map((alias) => known.get(alias))
			.find(Boolean);
		if (!saved) {
			const name = gate.name ?? gate.id;
			await db
				.prepare(
					"INSERT INTO ai_policy_codes(name,code) VALUES(?,?) ON CONFLICT DO NOTHING",
				)
				.bind(name, POLICY_CODES[name] ?? null)
				.run();
			saved =
				(await db
					.prepare("SELECT id,code FROM ai_policy_codes WHERE name=?")
					.bind(name)
					.first<{ id: number; code: string | null }>()) ?? undefined;
		}
		if (!saved) throw new Error("Cannot allocate policy code");
		for (const alias of aliases.filter((value) => !known.has(value))) {
			await db
				.prepare(
					"INSERT INTO ai_policy_aliases(project_id,gate_id,policy_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
				)
				.bind(projectId, alias, saved.id)
				.run();
			known.set(alias, { gate_id: alias, ...saved });
		}
		for (const alias of aliases) codes.set(alias, saved.code ?? `P${saved.id}`);
	}
	return codes;
}
