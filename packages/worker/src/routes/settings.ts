import type { Context } from "hono";
import { batchChanges } from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import {
	diffBusiness,
	jsonText,
	parseBusinessInput,
	rowsToAppSettings,
	type SettingsRow,
} from "../lib/settings.js";
import { settingsPutCasOutcome } from "../lib/settings-cas.js";
import type { AppEnv } from "../types.js";

export async function loadSettings(db: D1Database) {
	const res = await db
		.prepare("SELECT key, value, updated_at FROM settings")
		.all<SettingsRow>();
	return rowsToAppSettings(res.results ?? []);
}

export async function settingsGetRoute(c: Context<AppEnv>) {
	const settings = await loadSettings(c.env.DB);
	return c.json(settings);
}

export async function settingsPutRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	if (!asObjectBody(raw.value)) {
		return c.json({ error: "Invalid payload" }, 400);
	}

	const parsed = parseBusinessInput(raw.value);
	if (!parsed.ok) {
		return c.json({ error: parsed.error }, 400);
	}

	const current = await loadSettings(c.env.DB);
	const diff = diffBusiness(current, parsed.value);

	if (!diff.changed) {
		if (parsed.expectedVersion !== current.pipelineConfigVersion) {
			return c.json(
				{
					error: "Version conflict",
					currentVersion: current.pipelineConfigVersion,
				},
				409,
			);
		}
		return c.json({
			settings: current,
			recomputeRequired: false,
			recomputeKind: "none" as const,
		});
	}

	const expectedSql = String(parsed.expectedVersion);
	const nextSql = String(parsed.expectedVersion + 1);

	const stmts = [
		c.env.DB.prepare(
			`UPDATE settings SET value = ?, updated_at = unixepoch()
       WHERE key = 'timezone'
         AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
		).bind(jsonText(parsed.value.timezone), expectedSql),
		c.env.DB.prepare(
			`UPDATE settings SET value = ?, updated_at = unixepoch()
       WHERE key = 'email_suffixes'
         AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
		).bind(jsonText(parsed.value.emailSuffixes), expectedSql),
		c.env.DB.prepare(
			`UPDATE settings SET value = ?, updated_at = unixepoch()
       WHERE key = 'activity_weights'
         AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
		).bind(jsonText(parsed.value.activityWeights), expectedSql),
		c.env.DB.prepare(
			`UPDATE settings SET value = 'true', updated_at = unixepoch()
       WHERE key = 'scores_stale'
         AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
		).bind(expectedSql),
		c.env.DB.prepare(
			`UPDATE settings SET value = ?, updated_at = unixepoch()
       WHERE key = 'scores_stale_reason'
         AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
		).bind(jsonText(diff.reason), expectedSql),
		c.env.DB.prepare(
			`UPDATE settings SET value = ?, updated_at = unixepoch()
       WHERE key = 'pipeline_config_version' AND value = ?`,
		).bind(nextSql, expectedSql),
	];

	const results = await c.env.DB.batch(stmts);
	const bumpChanges = batchChanges(results[results.length - 1]);

	if (settingsPutCasOutcome(bumpChanges) === "conflict") {
		const latest = await loadSettings(c.env.DB);
		return c.json(
			{
				error: "Version conflict",
				currentVersion: latest.pipelineConfigVersion,
			},
			409,
		);
	}

	const after = await loadSettings(c.env.DB);
	return c.json({
		settings: after,
		recomputeRequired: true,
		recomputeKind: "full_rematch" as const,
	});
}
