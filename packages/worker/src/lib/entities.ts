import { newId } from "./ids.js";
import { jsonText } from "./settings.js";

export type DeveloperRow = {
	id: string;
	name: string;
	alias: string;
	avatar_url: string | null;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
};

export type TeamRow = {
	id: string;
	name: string;
	avatar_url: string | null;
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
	/** ADO project GUID; null until backfilled via Web CRUD. */
	project_external_id: string | null;
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
 * Prefer same `db.batch` as entity INSERT.
 *
 * When chained after an entity UPDATE, pass `onlyIfPreviousChanges: true` so
 * bump statements use SQLite `changes() > 0` and no-op if the UPDATE matched 0 rows.
 */
export function staleBumpStatements(
	db: D1Database,
	reason: string,
	opts?: { onlyIfPreviousChanges?: boolean },
): D1PreparedStatement[] {
	const guard = opts?.onlyIfPreviousChanges ? " AND changes() > 0" : "";
	return [
		db.prepare(
			`UPDATE settings
       SET value = CAST(value AS INTEGER) + 1, updated_at = unixepoch()
       WHERE key = 'pipeline_config_version'${guard}`,
		),
		db.prepare(
			`UPDATE settings SET value = 'true', updated_at = unixepoch()
       WHERE key = 'scores_stale'${guard}`,
		),
		db
			.prepare(
				`UPDATE settings SET value = ?, updated_at = unixepoch()
         WHERE key = 'scores_stale_reason'${guard}`,
			)
			.bind(jsonText(reason)),
	];
}

/** Archive developer + stale bump in one batch (bump gated on archive changes()). */
export function archiveDeveloperBatch(
	db: D1Database,
	id: string,
): D1PreparedStatement[] {
	return [
		db
			.prepare(
				`UPDATE developers SET archived_at = unixepoch(), updated_at = unixepoch()
         WHERE id = ? AND archived_at IS NULL`,
			)
			.bind(id),
		...staleBumpStatements(db, "developer archived", {
			onlyIfPreviousChanges: true,
		}),
	];
}

/** Restore developer + stale bump in one batch. */
export function restoreDeveloperBatch(
	db: D1Database,
	id: string,
): D1PreparedStatement[] {
	return [
		db
			.prepare(
				`UPDATE developers SET archived_at = NULL, updated_at = unixepoch()
         WHERE id = ? AND archived_at IS NOT NULL`,
			)
			.bind(id),
		...staleBumpStatements(db, "developer restored", {
			onlyIfPreviousChanges: true,
		}),
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

/**
 * Normalise an avatar URL from a request body.
 *
 * Three outcomes, kept distinct on purpose:
 *   `{ absent: true }` — field not in the body; leave the stored value alone.
 *   `{ value: null }`  — explicitly cleared, or blank. One stored form for "no
 *                        image", so the UI has one case to handle.
 *   `{ error }`        — present but unusable; the caller answers 400.
 *
 * Folding the last two together would silently drop a mistyped URL and report
 * success. Only http(s) is accepted: a `javascript:` or `data:` URL rendered
 * into an `<img src>` is a scripting vector, and this value is shown to every
 * viewer of the page.
 */
export type AvatarUrlResult =
	| { absent: true }
	| { value: string | null }
	| { error: string };

export const AVATAR_URL_MAX = 2048;

export function normalizeAvatarUrl(v: unknown): AvatarUrlResult {
	if (v === undefined) {
		return { absent: true };
	}
	if (v === null) {
		return { value: null };
	}
	if (typeof v !== "string") {
		return { error: "avatarUrl must be a string or null" };
	}
	const t = v.trim();
	if (!t) {
		return { value: null };
	}
	if (t.length > AVATAR_URL_MAX) {
		return { error: `avatarUrl exceeds ${AVATAR_URL_MAX} characters` };
	}
	let u: URL;
	try {
		u = new URL(t);
	} catch {
		return { error: "avatarUrl must be an absolute http(s) URL" };
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		return { error: "avatarUrl must use http or https" };
	}
	return { value: t };
}

/**
 * Read a `teamIds` array from a request body.
 *
 * Absent means "leave memberships alone"; an empty array means "remove them
 * all". Those are different intentions and a PATCH must be able to express
 * both, so they are not folded together.
 */
export type TeamIdsResult =
	| { absent: true }
	| { value: string[] }
	| { error: string };

export const TEAM_IDS_MAX = 64;

export function readTeamIds(v: unknown): TeamIdsResult {
	if (v === undefined) {
		return { absent: true };
	}
	if (!Array.isArray(v)) {
		return { error: "teamIds must be an array" };
	}
	if (v.length > TEAM_IDS_MAX) {
		return { error: `teamIds exceeds ${TEAM_IDS_MAX} entries` };
	}
	const out: string[] = [];
	for (const raw of v) {
		if (typeof raw !== "string" || !raw.trim()) {
			return { error: "teamIds must contain non-empty strings" };
		}
		const id = raw.trim();
		// Duplicates would hit the composite primary key and roll the whole
		// batch back — a 500 for what is really a harmless repeated selection.
		if (!out.includes(id)) {
			out.push(id);
		}
	}
	return { value: out };
}

/**
 * Statements that make `developer_teams` match `teamIds` exactly.
 *
 * Delete-then-insert rather than a diff: the set is tiny, and a diff would need
 * to read current state first, which cannot happen inside the same batch.
 * `INSERT ... SELECT ... WHERE EXISTS` skips ids that name no live team, so a
 * stale id from a client cannot fail the whole write.
 */
export function membershipStatements(
	db: D1Database,
	developerId: string,
	teamIds: readonly string[],
): D1PreparedStatement[] {
	const stmts = [
		db
			.prepare("DELETE FROM developer_teams WHERE developer_id = ?")
			.bind(developerId),
	];
	for (const teamId of teamIds) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO developer_teams (developer_id, team_id, created_at)
           SELECT ?, ?, unixepoch()
           WHERE EXISTS (
             SELECT 1 FROM teams WHERE id = ? AND archived_at IS NULL
           )`,
				)
				.bind(developerId, teamId, teamId),
		);
	}
	return stmts;
}
