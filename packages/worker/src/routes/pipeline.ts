import { INGEST_MAX_PAYLOAD_BYTES } from "@signoff/domain";
import type { Context } from "hono";
import { bootstrapSnapshotStatements } from "../lib/bootstrap.js";
import {
	batchChanges,
	clearStaleCasStatements,
	type DeveloperRow,
	type RepoRow,
} from "../lib/entities.js";
import {
	asObjectBody,
	readJsonBody,
	readJsonBodyWithSize,
} from "../lib/http-body.js";
import { gatePipelineIngest } from "../lib/pipeline-ingest.js";
import { processIngestChunk } from "../lib/pipeline-ingest-write.js";
import { rowsToAppSettings, type SettingsRow } from "../lib/settings.js";
import type { AppEnv } from "../types.js";
import { loadSettings } from "./settings.js";

/** GET /api/pipeline/bootstrap — one batch snapshot (settings + devs + repos). */
export async function pipelineBootstrapRoute(c: Context<AppEnv>) {
	const results = await c.env.DB.batch(bootstrapSnapshotStatements(c.env.DB));

	const settingsRows =
		(results[0] as D1Result<SettingsRow> | undefined)?.results ?? [];
	const devs =
		(
			results[1] as
				| D1Result<Pick<DeveloperRow, "id" | "name" | "alias">>
				| undefined
		)?.results ?? [];
	const repos =
		(
			results[2] as
				| D1Result<
						Pick<
							RepoRow,
							| "id"
							| "provider"
							| "org"
							| "project"
							| "name"
							| "external_id"
							| "project_external_id"
							| "enabled"
						>
				  >
				| undefined
		)?.results ?? [];

	const settings = rowsToAppSettings(settingsRows);

	return c.json({
		fetchedAt: new Date().toISOString(),
		settings: {
			timezone: settings.timezone,
			emailSuffixes: settings.emailSuffixes,
			activityWeights: settings.activityWeights,
			pipelineConfigVersion: settings.pipelineConfigVersion,
			scoresStale: settings.scoresStale,
			scoresStaleReason: settings.scoresStaleReason,
		},
		developers: devs.map((d) => ({
			id: d.id,
			name: d.name,
			alias: d.alias,
		})),
		repos: repos.map((r) => ({
			id: r.id,
			provider: r.provider,
			org: r.org,
			project: r.project,
			name: r.name,
			externalId: r.external_id,
			projectExternalId: r.project_external_id,
			enabled: r.enabled === 1,
		})),
	});
}

/**
 * POST /api/pipeline/ingest — 06: precheck then multi-phase write.
 * Precheck: payload 413 → Zod 400 → version gate 409 → write (422/409/500/200).
 */
export async function pipelineIngestRoute(c: Context<AppEnv>) {
	// Size gate first — never touch Settings/D1 for oversized bodies (§5.2 / §5.8).
	const raw = await readJsonBodyWithSize(c, INGEST_MAX_PAYLOAD_BYTES);
	if (!raw.ok) {
		if (raw.error === "payload_too_large") {
			return c.json({ error: "Payload too large" }, 413);
		}
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const settings = await loadSettings(c.env.DB);
	const gate = gatePipelineIngest(raw.value, settings.pipelineConfigVersion, {
		rawByteLength: raw.byteLength,
	});

	if (gate.kind === "payload_too_large") {
		return c.json({ error: "Payload too large" }, 413);
	}
	if (gate.kind === "bad_request") {
		return c.json({ error: gate.error }, 400);
	}
	if (gate.kind === "conflict") {
		return c.json(
			{
				error: "Version conflict",
				currentVersion: gate.currentVersion,
			},
			409,
		);
	}

	const result = await processIngestChunk(c.env.DB, gate.body, settings);
	if (result.kind === "ok") {
		return c.json(result.body, 200);
	}
	if (result.kind === "conflict") {
		return c.json({ error: result.error }, 409);
	}
	if (result.kind === "unprocessable") {
		return c.json({ error: result.error }, 422);
	}
	if (result.kind === "bad_request") {
		return c.json({ error: result.error }, 400);
	}
	return c.json({ error: result.error }, 500);
}

/**
 * POST /api/pipeline/recompute/complete — clear stale with version CAS.
 * 05 §5.7 / 06: run must be finalized + full_rematch; triple version check.
 */
export async function pipelineRecomputeCompleteRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const body = asObjectBody(raw.value);
	if (!body) {
		return c.json({ error: "Invalid payload" }, 400);
	}
	if (
		typeof body.pipelineConfigVersion !== "number" ||
		!Number.isInteger(body.pipelineConfigVersion)
	) {
		return c.json({ error: "pipelineConfigVersion required (integer)" }, 400);
	}
	if (typeof body.runId !== "string" || body.runId.trim().length === 0) {
		return c.json({ error: "runId required (string)" }, 400);
	}
	if (body.ok !== true) {
		return c.json({ error: "ok must be true to clear stale" }, 400);
	}

	const expected = body.pipelineConfigVersion;
	const run = await c.env.DB.prepare(
		"SELECT status, mode, config_version FROM ingest_runs WHERE id = ?",
	)
		.bind(body.runId)
		.first<{ status: string; mode: string; config_version: number }>();

	if (
		run?.status !== "finalized" ||
		run.mode !== "full_rematch" ||
		run.config_version !== expected
	) {
		return c.json(
			{
				error:
					"Run must be finalized full_rematch with matching pipelineConfigVersion",
			},
			409,
		);
	}

	const settingsNow = await loadSettings(c.env.DB);
	if (settingsNow.pipelineConfigVersion !== expected) {
		return c.json(
			{
				error: "Version conflict",
				currentVersion: settingsNow.pipelineConfigVersion,
			},
			409,
		);
	}

	const results = await c.env.DB.batch(
		clearStaleCasStatements(c.env.DB, expected),
	);
	const changes = batchChanges(results[0]);
	if (changes !== 1) {
		const settings = await loadSettings(c.env.DB);
		return c.json(
			{
				error: "Version conflict",
				currentVersion: settings.pipelineConfigVersion,
			},
			409,
		);
	}

	const settings = await loadSettings(c.env.DB);
	return c.json({
		ok: true,
		runId: body.runId,
		settings,
	});
}
