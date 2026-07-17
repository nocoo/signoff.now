import type { Context } from "hono";
import {
	batchChanges,
	clearStaleCasStatements,
	type DeveloperRow,
	type RepoRow,
} from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";
import { loadSettings } from "./settings.js";

/** GET /api/pipeline/bootstrap — CLI settings + entities (phase-1). */
export async function pipelineBootstrapRoute(c: Context<AppEnv>) {
	const settings = await loadSettings(c.env.DB);
	const devs = await c.env.DB.prepare(
		`SELECT id, name, alias FROM developers WHERE archived_at IS NULL ORDER BY name`,
	).all<Pick<DeveloperRow, "id" | "name" | "alias">>();
	const repos = await c.env.DB.prepare(
		`SELECT id, provider, org, project, name, external_id, enabled
     FROM repos WHERE archived_at IS NULL AND enabled = 1 ORDER BY org, project, name`,
	).all<
		Pick<
			RepoRow,
			"id" | "provider" | "org" | "project" | "name" | "external_id" | "enabled"
		>
	>();

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
		developers: (devs.results ?? []).map((d) => ({
			id: d.id,
			name: d.name,
			alias: d.alias,
		})),
		repos: (repos.results ?? []).map((r) => ({
			id: r.id,
			provider: r.provider,
			org: r.org,
			project: r.project,
			name: r.name,
			externalId: r.external_id,
			enabled: r.enabled === 1,
		})),
	});
}

/**
 * POST /api/pipeline/ingest — version gate only (full body ingest later).
 * Requires pipelineConfigVersion === current.
 */
export async function pipelineIngestRoute(c: Context<AppEnv>) {
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
	const settings = await loadSettings(c.env.DB);
	if (body.pipelineConfigVersion !== settings.pipelineConfigVersion) {
		return c.json(
			{
				error: "Version conflict",
				currentVersion: settings.pipelineConfigVersion,
			},
			409,
		);
	}
	// Phase-1: accept empty activity payload; real upsert comes later
	return c.json({
		ok: true,
		pipelineConfigVersion: settings.pipelineConfigVersion,
		accepted: Array.isArray(body.activities) ? body.activities.length : 0,
	});
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
