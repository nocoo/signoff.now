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
import {
	gatePipelineIngest,
	ingestNotImplementedBody,
} from "../lib/pipeline-ingest.js";
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
 * POST /api/pipeline/ingest — 05: precheck then 501 (no Activity/Score writes).
 * Precheck order (§5.8): payload 413 → Zod 400 → version gate 409 → 501.
 */
export async function pipelineIngestRoute(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c);
	if (!raw.ok) {
		if (raw.byteLength > INGEST_MAX_PAYLOAD_BYTES) {
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

	return c.json(ingestNotImplementedBody(gate.currentVersion), 501);
}

/**
 * POST /api/pipeline/recompute/complete — clear stale with version CAS.
 * 05 §5.7: body must include runId + pipelineConfigVersion + ok:true.
 * Full run-status / mode checks land in 06 with ingest_runs rebuild.
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
