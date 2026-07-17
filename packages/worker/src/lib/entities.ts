import { newId } from "./ids.js";
import { jsonText } from "./settings.js";

export type DeveloperRow = {
	id: string;
	name: string;
	alias: string;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
};

export type TeamRow = {
	id: string;
	name: string;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
};

export type TagRow = {
	id: string;
	name: string;
	color: string;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
};

export type RepoRow = {
	id: string;
	provider: string;
	org: string;
	project: string;
	name: string;
	remote_url: string | null;
	external_id: string | null;
	enabled: number;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
};

export function normalizeAlias(alias: unknown): string | null {
	if (typeof alias !== "string") {
		return null;
	}
	const a = alias.trim().toLowerCase();
	if (!a || a.includes("@") || a.includes(" ")) {
		return null;
	}
	return a;
}

export function normalizeName(name: unknown): string | null {
	if (typeof name !== "string") {
		return null;
	}
	const n = name.trim();
	return n.length > 0 ? n : null;
}

export function normalizeColor(color: unknown): string | null {
	if (typeof color !== "string") {
		return null;
	}
	const c = color.trim();
	if (!/^#[0-9A-Fa-f]{6}$/.test(c)) {
		return null;
	}
	return c.toUpperCase();
}

/**
 * Atomic config version +1 and stale flags (no pre-read RMW).
 * Prefer same `db.batch` as entity INSERT; for UPDATE check changes first.
 */
export function staleBumpStatements(
	db: D1Database,
	reason: string,
): D1PreparedStatement[] {
	return [
		db.prepare(
			`UPDATE settings
       SET value = CAST(value AS INTEGER) + 1, updated_at = unixepoch()
       WHERE key = 'pipeline_config_version'`,
		),
		db.prepare(
			`UPDATE settings SET value = 'true', updated_at = unixepoch()
       WHERE key = 'scores_stale'`,
		),
		db
			.prepare(
				`UPDATE settings SET value = ?, updated_at = unixepoch()
         WHERE key = 'scores_stale_reason'`,
			)
			.bind(jsonText(reason)),
	];
}

/**
 * Clear stale only when version still equals expected (SQL CAS).
 * Returns statements for one batch; caller checks changes on scores_stale update.
 */
export function clearStaleCasStatements(
	db: D1Database,
	expectedVersion: number,
): D1PreparedStatement[] {
	const expected = String(expectedVersion);
	return [
		db
			.prepare(
				`UPDATE settings SET value = 'false', updated_at = unixepoch()
         WHERE key = 'scores_stale'
           AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
			)
			.bind(expected),
		db
			.prepare(
				`UPDATE settings SET value = 'null', updated_at = unixepoch()
         WHERE key = 'scores_stale_reason'
           AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?`,
			)
			.bind(expected),
	];
}

export function batchChanges(result: D1Result | undefined): number {
	if (!result?.meta || typeof result.meta !== "object") {
		return 0;
	}
	return (result.meta as { changes?: number }).changes ?? 0;
}

export { newId };
