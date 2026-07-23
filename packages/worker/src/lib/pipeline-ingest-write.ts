/**
 * 06 ingest write path: Phase 0–4 multi-stage Activity/Score persistence.
 */

import {
	type Activity,
	type ActivityWithDayKey,
	activitySchema,
	aggregateScores,
	buildExternalRef,
	dayKey,
	type IngestBody,
} from "@signoff/domain";
import { newId } from "./ids.js";
import type { AppSettings } from "./settings.js";
import { sha256Hex, stableStringify } from "./stable-json.js";

export type IngestWriteResult =
	| {
			kind: "ok";
			body: {
				runId: string;
				chunkIndex: number;
				pipelineConfigVersion: number;
				activities: {
					received: number;
					upserted: number;
					rejected: number;
				};
				scores: { affectedDevDays: number; recomputed: number };
				unmatched: { upserted: number };
				finalized: boolean;
			};
	  }
	| { kind: "conflict"; error: string }
	| { kind: "unprocessable"; error: string }
	| { kind: "bad_request"; error: string }
	| { kind: "server_error"; error: string };

type DevDay = { developerId: string; dayKey: string };

function runMetaEqual(
	a: IngestBody["runMeta"],
	b: IngestBody["runMeta"],
): boolean {
	return (
		a.startedAt === b.startedAt &&
		a.source === b.source &&
		a.windowFrom === b.windowFrom &&
		a.windowTo === b.windowTo &&
		a.mode === b.mode
	);
}

/** Multi-phase ingest: intentionally branched; covered by unit + E2E tests. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 06 multi-phase state machine
export async function processIngestChunk(
	db: D1Database,
	body: IngestBody,
	settings: AppSettings,
): Promise<IngestWriteResult> {
	const digest = await sha256Hex(stableStringify(body));
	const version = settings.pipelineConfigVersion;

	const run = await db
		.prepare("SELECT * FROM ingest_runs WHERE id = ?")
		.bind(body.runId)
		.first<{
			id: string;
			status: string;
			config_version: number;
			mode: string;
			run_meta_json: string;
		}>();

	const chunk = await db
		.prepare("SELECT * FROM ingest_chunks WHERE run_id = ? AND chunk_index = ?")
		.bind(body.runId, body.chunkIndex)
		.first<{
			status: string;
			digest: string;
			dev_day_union_json: string;
		}>();

	// Completed chunk, same digest → idempotent
	if (chunk?.status === "completed" && chunk.digest === digest) {
		if (body.isFinalChunk && run?.status === "chunked") {
			const fin = await finalizeRun(db, body.runId, version);
			if (fin.kind !== "ok") {
				return fin;
			}
			return successBody(body, version, 0, 0, 0, true);
		}
		return successBody(
			body,
			version,
			0,
			0,
			0,
			run?.status === "finalized" && body.isFinalChunk,
		);
	}

	if (chunk && chunk.digest !== digest) {
		return { kind: "conflict", error: "Chunk digest conflict" };
	}

	if (run?.status === "finalized") {
		return { kind: "conflict", error: "Run already finalized" };
	}

	if (run && run.config_version !== version) {
		return { kind: "conflict", error: "Run config version mismatch" };
	}

	let effectiveMode: "incremental" | "full_rematch";
	if (!run) {
		if (body.chunkIndex !== 0) {
			return {
				kind: "bad_request",
				error: "Unknown run; chunkIndex must be 0",
			};
		}
		effectiveMode = body.runMeta.mode;
	} else {
		const stored = JSON.parse(run.run_meta_json) as IngestBody["runMeta"];
		if (!runMetaEqual(body.runMeta, stored)) {
			return { kind: "conflict", error: "runMeta drift" };
		}
		effectiveMode = run.mode as "incremental" | "full_rematch";
	}

	// Skip-ahead detection
	if (!chunk) {
		const maxRow = await db
			.prepare(
				"SELECT MAX(chunk_index) AS m FROM ingest_chunks WHERE run_id = ?",
			)
			.bind(body.runId)
			.first<{ m: number | null }>();
		const maxIdx = maxRow?.m ?? -1;
		if (body.chunkIndex > maxIdx + 1) {
			return { kind: "bad_request", error: "chunkIndex skip" };
		}
	}

	// prepared retry: jump to score phase using stored union
	if (chunk?.status === "prepared" && chunk.digest === digest) {
		const union = JSON.parse(chunk.dev_day_union_json) as DevDay[];
		return await recomputeScoresAndComplete(
			db,
			body,
			settings,
			version,
			union,
			0,
			0,
		);
	}

	// --- Phase 0: validate + compute external refs / day keys (batched reads) ---
	const prepared: Array<{
		activity: Activity;
		externalRef: string;
		dayKey: string;
		metaJson: string | null;
		sourceIdsJson: string;
	}> = [];

	for (const a of body.activities) {
		let externalRef: string;
		let dk: string;
		try {
			externalRef = buildExternalRef(a.type, a.sourceIds);
			dk = dayKey(a.occurredAt, settings.timezone);
		} catch {
			return { kind: "server_error", error: "Invalid timezone or sourceIds" };
		}
		prepared.push({
			activity: a,
			externalRef,
			dayKey: dk,
			metaJson: a.meta ? JSON.stringify(a.meta) : null,
			sourceIdsJson: JSON.stringify(a.sourceIds),
		});
	}

	const devIds = [...new Set(body.activities.map((a) => a.developerId))];
	const repoIds = [
		...new Set(
			body.activities
				.map((a) => a.repoId)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	];

	const devMap = new Map<
		string,
		{ id: string; alias: string; archived_at: number | null }
	>();
	if (devIds.length > 0) {
		const ph = devIds.map(() => "?").join(",");
		const devRows = await db
			.prepare(
				`SELECT id, alias, archived_at FROM developers WHERE id IN (${ph})`,
			)
			.bind(...devIds)
			.all<{ id: string; alias: string; archived_at: number | null }>();
		for (const d of devRows.results ?? []) {
			devMap.set(d.id, d);
		}
	}

	const repoMap = new Map<
		string,
		{
			id: string;
			provider: string;
			org: string;
			project: string;
			external_id: string | null;
			enabled: number;
			archived_at: number | null;
		}
	>();
	if (repoIds.length > 0) {
		const ph = repoIds.map(() => "?").join(",");
		const repoRows = await db
			.prepare(
				`SELECT id, provider, org, project, external_id, enabled, archived_at
         FROM repos WHERE id IN (${ph})`,
			)
			.bind(...repoIds)
			.all<{
				id: string;
				provider: string;
				org: string;
				project: string;
				external_id: string | null;
				enabled: number;
				archived_at: number | null;
			}>();
		for (const r of repoRows.results ?? []) {
			repoMap.set(r.id, r);
		}
	}

	const refOwner = new Map<string, string>();
	if (prepared.length > 0) {
		const refs = prepared.map((p) => p.externalRef);
		const ph = refs.map(() => "?").join(",");
		const existing = await db
			.prepare(
				`SELECT external_ref, developer_id FROM activities WHERE external_ref IN (${ph})`,
			)
			.bind(...refs)
			.all<{ external_ref: string; developer_id: string }>();
		for (const row of existing.results ?? []) {
			refOwner.set(row.external_ref, row.developer_id);
		}
	}

	for (const p of prepared) {
		const a = p.activity;
		const dev = devMap.get(a.developerId);
		if (!dev || dev.archived_at !== null) {
			return {
				kind: "unprocessable",
				error: `developerId not found or archived: ${a.developerId}`,
			};
		}
		const expectedNames = settings.emailSuffixes.map((s) =>
			`${dev.alias}@${s}`.toLowerCase(),
		);
		if (!expectedNames.includes(a.matchedUniqueName.toLowerCase())) {
			return {
				kind: "unprocessable",
				error: `matchedUniqueName mismatch for ${a.developerId}`,
			};
		}

		if (a.type.startsWith("pr.")) {
			if (!a.repoId) {
				return { kind: "unprocessable", error: "pr.* requires repoId" };
			}
			const repo = repoMap.get(a.repoId);
			if (!repo || repo.archived_at !== null || repo.enabled !== 1) {
				return {
					kind: "unprocessable",
					error: `repoId invalid: ${a.repoId}`,
				};
			}
			const prGuid = (a.sourceIds as { prRepoGuid: string }).prRepoGuid;
			if (repo.external_id !== prGuid) {
				return {
					kind: "unprocessable",
					error: "prRepoGuid does not match repo.external_id",
				};
			}
			if (
				repo.provider !== a.provider ||
				repo.org !== a.org ||
				repo.project !== a.project
			) {
				return {
					kind: "unprocessable",
					error: "org/project/provider mismatch for repo",
				};
			}
		} else {
			if (a.repoId !== null) {
				return { kind: "unprocessable", error: "wi.* requires repoId null" };
			}
			const projectGuid = (a.sourceIds as { projectGuid: string }).projectGuid;
			const hit = await db
				.prepare(
					`SELECT id FROM repos
           WHERE provider = ? AND org = ? AND project = ?
             AND project_external_id = ?
             AND archived_at IS NULL
           LIMIT 1`,
				)
				.bind(a.provider, a.org, a.project, projectGuid)
				.first();
			if (!hit) {
				return {
					kind: "unprocessable",
					error: "projectGuid not found for org/project",
				};
			}
		}

		const owner = refOwner.get(p.externalRef);
		if (owner && owner !== a.developerId && effectiveMode !== "full_rematch") {
			return {
				kind: "unprocessable",
				error: "external_ref owned by another developer",
			};
		}
	}

	// Old dev-days for rematch (no config_version filter); reuse refOwner query shape
	const oldDevDays: DevDay[] = [];
	if (prepared.length > 0) {
		const refs = prepared.map((p) => p.externalRef);
		const placeholders = refs.map(() => "?").join(",");
		const old = await db
			.prepare(
				`SELECT developer_id, day_key FROM activities WHERE external_ref IN (${placeholders})`,
			)
			.bind(...refs)
			.all<{ developer_id: string; day_key: string }>();
		for (const r of old.results ?? []) {
			oldDevDays.push({ developerId: r.developer_id, dayKey: r.day_key });
		}
	}

	const newDevDays: DevDay[] = prepared.map((p) => ({
		developerId: p.activity.developerId,
		dayKey: p.dayKey,
	}));
	const unionMap = new Map<string, DevDay>();
	for (const d of [...oldDevDays, ...newDevDays]) {
		unionMap.set(`${d.developerId}\0${d.dayKey}`, d);
	}
	const union = [...unionMap.values()];
	const unionJson = JSON.stringify(union);

	// --- Phase 1: CAS existing run first (must observe changes), then write batch ---
	if (run) {
		const cas = await db
			.prepare(
				`UPDATE ingest_runs SET stats_json = stats_json
         WHERE id = ? AND config_version = ? AND mode = ? AND status = 'chunked'`,
			)
			.bind(body.runId, version, run.mode)
			.run();
		if ((cas.meta?.changes ?? 0) !== 1) {
			return {
				kind: "conflict",
				error: "Run CAS failed (status/version/mode mismatch)",
			};
		}
	}

	const stmts: D1PreparedStatement[] = [];
	if (!run) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO ingest_runs (id, started_at, finished_at, status, config_version, mode, run_meta_json, stats_json)
           VALUES (?, ?, NULL, 'chunked', ?, ?, ?, NULL)`,
				)
				.bind(
					body.runId,
					body.runMeta.startedAt,
					version,
					body.runMeta.mode,
					JSON.stringify(body.runMeta),
				),
		);
	}

	// Always mint id on INSERT; ON CONFLICT keeps existing row id (id not in UPDATE set).
	for (const p of prepared) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO activities (
            id, developer_id, type, occurred_at, day_key, config_version,
            provider, org, project, repo_id, external_ref, matched_unique_name,
            source_ids_json, meta_json, ingested_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(external_ref) DO UPDATE SET
            developer_id = excluded.developer_id,
            type = excluded.type,
            occurred_at = excluded.occurred_at,
            day_key = excluded.day_key,
            config_version = excluded.config_version,
            provider = excluded.provider,
            org = excluded.org,
            project = excluded.project,
            repo_id = excluded.repo_id,
            matched_unique_name = excluded.matched_unique_name,
            source_ids_json = excluded.source_ids_json,
            meta_json = excluded.meta_json,
            ingested_at = unixepoch()`,
				)
				.bind(
					newId(),
					p.activity.developerId,
					p.activity.type,
					p.activity.occurredAt,
					p.dayKey,
					version,
					p.activity.provider,
					p.activity.org,
					p.activity.project,
					p.activity.repoId,
					p.externalRef,
					p.activity.matchedUniqueName,
					p.sourceIdsJson,
					p.metaJson,
				),
		);
	}

	for (const u of body.unmatchedIdentities) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO unmatched_identities (unique_name, last_seen_at, seen_count, sample_org, sample_project, sample_context)
           VALUES (?, unixepoch(), 1, ?, ?, ?)
           ON CONFLICT(unique_name) DO UPDATE SET
             last_seen_at = unixepoch(),
             seen_count = seen_count + 1,
             sample_org = excluded.sample_org,
             sample_project = excluded.sample_project,
             sample_context = excluded.sample_context`,
				)
				.bind(
					u.uniqueName,
					u.sampleOrg ?? null,
					u.sampleProject ?? null,
					u.sampleContext ?? null,
				),
		);
	}

	stmts.push(
		db
			.prepare(
				`INSERT INTO ingest_chunks (run_id, chunk_index, status, digest, dev_day_union_json, finished_at)
         VALUES (?, ?, 'prepared', ?, ?, NULL)`,
			)
			.bind(body.runId, body.chunkIndex, digest, unionJson),
	);

	try {
		await db.batch(stmts);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// Concurrent INSERT ingest_runs → unique constraint → whole batch rolls back
		if (/UNIQUE|constraint|already exists/i.test(msg)) {
			return {
				kind: "server_error",
				error: "Concurrent run insert race",
			};
		}
		return { kind: "server_error", error: msg };
	}

	return await recomputeScoresAndComplete(
		db,
		body,
		settings,
		version,
		union,
		prepared.length,
		body.unmatchedIdentities.length,
	);
}

async function recomputeScoresAndComplete(
	db: D1Database,
	body: IngestBody,
	settings: AppSettings,
	version: number,
	union: DevDay[],
	upserted: number,
	unmatchedUpserted: number,
): Promise<IngestWriteResult> {
	// Phase 3 version re-check
	const verRow = await db
		.prepare(
			"SELECT CAST(value AS INTEGER) AS v FROM settings WHERE key = 'pipeline_config_version'",
		)
		.first<{ v: number }>();
	if (verRow?.v !== version) {
		return { kind: "conflict", error: "Version changed mid-ingest" };
	}

	const scoreStmts: D1PreparedStatement[] = [];
	let recomputed = 0;
	const affectedDevDays = union.length;

	if (union.length > 0) {
		// Single SELECT for all affected dev-days (≤20 pairs) — stmt budget.
		const pairClauses = union
			.map(() => "(developer_id = ? AND day_key = ?)")
			.join(" OR ");
		const binds: unknown[] = [version];
		for (const dd of union) {
			binds.push(dd.developerId, dd.dayKey);
		}
		const res = await db
			.prepare(
				`SELECT type, occurred_at, provider, org, project, repo_id, developer_id,
                matched_unique_name, source_ids_json, day_key
         FROM activities
         WHERE config_version = ?
           AND (${pairClauses})`,
			)
			.bind(...binds)
			.all<{
				type: string;
				occurred_at: number;
				provider: string;
				org: string;
				project: string;
				repo_id: string | null;
				developer_id: string;
				matched_unique_name: string | null;
				source_ids_json: string;
				day_key: string;
			}>();

		const enriched: ActivityWithDayKey[] = [];
		for (const row of res.results ?? []) {
			let sourceIds: unknown;
			try {
				sourceIds = JSON.parse(row.source_ids_json);
			} catch {
				return {
					kind: "server_error",
					error: "Corrupt source_ids_json",
				};
			}
			const candidate = {
				type: row.type,
				occurredAt: row.occurred_at,
				provider: row.provider,
				org: row.org,
				project: row.project,
				repoId: row.repo_id,
				developerId: row.developer_id,
				matchedUniqueName: row.matched_unique_name ?? "",
				sourceIds,
			};
			const parsed = activitySchema.safeParse(candidate);
			if (!parsed.success) {
				return {
					kind: "server_error",
					error: `source_ids_json shape mismatch for type=${row.type}`,
				};
			}
			enriched.push({ ...parsed.data, dayKey: row.day_key });
		}

		const scores = aggregateScores(
			enriched,
			settings.activityWeights as Parameters<typeof aggregateScores>[1],
		);
		const scoredKeys = new Set(
			scores.map((s) => `${s.developerId}\0${s.dayKey}`),
		);

		// UPSERT scores only while settings version still equals expected (05 triple check).
		for (const s of scores) {
			scoreStmts.push(
				db
					.prepare(
						`INSERT INTO scores (developer_id, day_key, config_version, total, breakdown_json, activity_count, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, unixepoch())
             ON CONFLICT(developer_id, day_key) DO UPDATE SET
               config_version = excluded.config_version,
               total = excluded.total,
               breakdown_json = excluded.breakdown_json,
               activity_count = excluded.activity_count,
               computed_at = unixepoch()
             WHERE (
               SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'pipeline_config_version'
             ) = excluded.config_version`,
					)
					.bind(
						s.developerId,
						s.dayKey,
						version,
						s.total,
						JSON.stringify(s.breakdown),
						s.activityCount,
					),
			);
			recomputed++;
		}

		// Empty aggregation: DELETE residual scores; still counts as recomputed (05 §5.3 #7).
		for (const dd of union) {
			const k = `${dd.developerId}\0${dd.dayKey}`;
			if (!scoredKeys.has(k)) {
				scoreStmts.push(
					db
						.prepare(
							`DELETE FROM scores
               WHERE developer_id = ? AND day_key = ? AND config_version = ?
                 AND (
                   SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'pipeline_config_version'
                 ) = ?`,
						)
						.bind(dd.developerId, dd.dayKey, version, version),
				);
				recomputed++;
			}
		}
	}

	// Score writes first, then chunk complete CAS (must observe changes=1).
	scoreStmts.push(
		db
			.prepare(
				`UPDATE ingest_chunks SET status = 'completed', finished_at = unixepoch()
         WHERE run_id = ? AND chunk_index = ? AND status = 'prepared'`,
			)
			.bind(body.runId, body.chunkIndex),
	);

	try {
		const results = await db.batch(scoreStmts);
		const completeRes = results[results.length - 1];
		const completeChanges =
			(completeRes as D1Result | undefined)?.meta?.changes ?? 0;
		if (completeChanges !== 1) {
			return {
				kind: "conflict",
				error: "Chunk complete CAS failed (not prepared or raced)",
			};
		}
	} catch (e) {
		return {
			kind: "server_error",
			error: e instanceof Error ? e.message : String(e),
		};
	}

	// Re-read settings version after score mutations
	const verAfter = await db
		.prepare(
			"SELECT CAST(value AS INTEGER) AS v FROM settings WHERE key = 'pipeline_config_version'",
		)
		.first<{ v: number }>();
	if (verAfter?.v !== version) {
		return { kind: "conflict", error: "Version changed during score write" };
	}

	let finalized = false;
	if (body.isFinalChunk) {
		const fin = await finalizeRun(db, body.runId, version);
		if (fin.kind === "ok") {
			finalized = true;
		} else if (fin.kind === "conflict") {
			const st = await db
				.prepare("SELECT status FROM ingest_runs WHERE id = ?")
				.bind(body.runId)
				.first<{ status: string }>();
			finalized = st?.status === "finalized";
			if (!finalized) {
				return fin;
			}
		} else {
			return fin;
		}
	}

	return successBody(
		body,
		version,
		upserted,
		recomputed,
		unmatchedUpserted,
		finalized,
		affectedDevDays,
	);
}

async function finalizeRun(
	db: D1Database,
	runId: string,
	version: number,
): Promise<IngestWriteResult | { kind: "ok" }> {
	const res = await db
		.prepare(
			`UPDATE ingest_runs
       SET status = 'finalized', finished_at = unixepoch()
       WHERE id = ? AND status = 'chunked' AND config_version = ?`,
		)
		.bind(runId, version)
		.run();
	const changes = res.meta?.changes ?? 0;
	if (changes === 0) {
		const st = await db
			.prepare("SELECT status FROM ingest_runs WHERE id = ?")
			.bind(runId)
			.first<{ status: string }>();
		if (st?.status === "finalized") {
			return { kind: "ok" };
		}
		return { kind: "conflict", error: "Cannot finalize run" };
	}
	return { kind: "ok" };
}

function successBody(
	body: IngestBody,
	version: number,
	upserted: number,
	recomputed: number,
	unmatchedUpserted: number,
	finalized: boolean,
	affectedDevDays = 0,
): IngestWriteResult {
	return {
		kind: "ok",
		body: {
			runId: body.runId,
			chunkIndex: body.chunkIndex,
			pipelineConfigVersion: version,
			activities: {
				received: body.activities.length,
				upserted,
				rejected: 0,
			},
			scores: {
				affectedDevDays,
				recomputed,
			},
			unmatched: { upserted: unmatchedUpserted },
			finalized,
		},
	};
}
