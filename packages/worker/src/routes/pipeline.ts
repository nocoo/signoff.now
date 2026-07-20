import type { Context } from "hono";
import { bootstrapSnapshotStatements } from "../lib/bootstrap.js";
import {
	batchChanges,
	clearStaleCasStatements,
	type DeveloperRow,
	type RepoRow,
} from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
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
 * POST /api/pipeline/ingest — not implemented for Activity/Score writes.
 * Returns 501 after validation so CLI never treats data as durable.
 */
export async function pipelineIngestRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const body = asObjectBody(raw.value);
	const settings = await loadSettings(c.env.DB);
	const gate = gatePipelineIngest(body, settings.pipelineConfigVersion);

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
		settings,
	});
}
