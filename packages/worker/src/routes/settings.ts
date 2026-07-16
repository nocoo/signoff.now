import type { Context } from "hono";
import {
	diffBusiness,
	jsonText,
	parseBusinessInput,
	rowsToAppSettings,
	type SettingsRow,
} from "../lib/settings.js";
import type { AppEnv } from "../types.js";

async function loadSettings(db: D1Database) {
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
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const parsed = parseBusinessInput(body);
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

	const expected = String(parsed.expectedVersion);
	const nextVersion = String(parsed.expectedVersion + 1);
	const expectedLit = jsonText(parsed.expectedVersion);
	// JSON number stored without extra quotes — seed uses bare `1`
	const expectedSql = expected;
	const nextSql = nextVersion;

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
	const bump = results[results.length - 1];
	const changes =
		bump && "meta" in bump && bump.meta && typeof bump.meta === "object"
			? ((bump.meta as { changes?: number }).changes ?? 0)
			: 0;

	// D1 batch may report changes differently; also compare reloaded version
	const after = await loadSettings(c.env.DB);
	if (
		changes === 0 &&
		after.pipelineConfigVersion === current.pipelineConfigVersion
	) {
		return c.json(
			{
				error: "Version conflict",
				currentVersion: after.pipelineConfigVersion,
			},
			409,
		);
	}

	if (after.pipelineConfigVersion !== parsed.expectedVersion + 1) {
		// Lost race or unexpected store format (JSON quoted number)
		// Retry path: accept if already advanced and matches business fields
		if (after.pipelineConfigVersion === current.pipelineConfigVersion) {
			// Try quoted JSON form for version CAS (json_valid stores as number text)
			return c.json(
				{
					error: "Version conflict",
					currentVersion: after.pipelineConfigVersion,
				},
				409,
			);
		}
	}

	void expectedLit;
	return c.json({
		settings: after,
		recomputeRequired: true,
		recomputeKind: "full_rematch" as const,
	});
}
