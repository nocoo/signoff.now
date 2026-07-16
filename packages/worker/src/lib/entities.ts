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

/** Bump pipeline version + mark stale (alias/match-set change). CAS free — single writer admin path. */
export async function bumpConfigStale(
	db: D1Database,
	reason: string,
): Promise<void> {
	const row = await db
		.prepare(`SELECT value FROM settings WHERE key = 'pipeline_config_version'`)
		.first<{ value: string }>();
	const current = Number(JSON.parse(row?.value ?? "1"));
	const next = (Number.isFinite(current) ? current : 1) + 1;
	await db.batch([
		db
			.prepare(
				`UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = 'pipeline_config_version'`,
			)
			.bind(String(next)),
		db.prepare(
			`UPDATE settings SET value = 'true', updated_at = unixepoch() WHERE key = 'scores_stale'`,
		),
		db
			.prepare(
				`UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = 'scores_stale_reason'`,
			)
			.bind(jsonText(reason)),
	]);
}

export { newId };
