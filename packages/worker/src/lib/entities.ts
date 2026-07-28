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
 * Two mutually exclusive guards, for batches where an earlier statement may
 * match zero rows (D1 rolls back on error, never on `changes === 0`):
 *
 * - `onlyIfPreviousChanges` — SQLite `changes() > 0`. Correct only when these
 *   statements come DIRECTLY after the gating write, since `changes()` reports
 *   whichever row-modifying statement ran last.
 * - `onlyIfLive` — an EXISTS on the row itself. Order-independent, so use it
 *   when other statements sit in between.
 */
export function staleBumpStatements(
	db: D1Database,
	reason: string,
	opts?: {
		onlyIfPreviousChanges?: boolean;
		onlyIfLive?: { table: "developers" | "teams" | "repos"; id: string };
	},
): D1PreparedStatement[] {
	if (opts?.onlyIfPreviousChanges && opts?.onlyIfLive) {
		throw new Error("staleBumpStatements: pick one guard, not both");
	}
	const live = opts?.onlyIfLive;
	const guard = opts?.onlyIfPreviousChanges
		? " AND changes() > 0"
		: live
			? ` AND EXISTS (SELECT 1 FROM ${live.table} WHERE id = ? AND archived_at IS NULL)`
			: "";
	// The EXISTS form takes a bound id; the others take none. Keeping the
	// binding next to the guard stops the two from drifting apart.
	const bind = <T extends D1PreparedStatement>(s: T, extra: unknown[] = []) =>
		live ? s.bind(...extra, live.id) : extra.length ? s.bind(...extra) : s;
	return [
		bind(
			db.prepare(
				`UPDATE settings
       SET value = CAST(value AS INTEGER) + 1, updated_at = unixepoch()
       WHERE key = 'pipeline_config_version'${guard}`,
			),
		),
		bind(
			db.prepare(
				`UPDATE settings SET value = 'true', updated_at = unixepoch()
       WHERE key = 'scores_stale'${guard}`,
			),
		),
		bind(
			db.prepare(
				`UPDATE settings SET value = ?, updated_at = unixepoch()
         WHERE key = 'scores_stale_reason'${guard}`,
			),
			[jsonText(reason)],
		),
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
	// Credentials in an image URL are never legitimate here, and a stored
	// `https://user:pw@host/x.png` would leak them to anyone who can read the
	// roster — including via the browser's network log on every page view.
	if (u.username || u.password) {
		return { error: "avatarUrl must not carry credentials" };
	}
	// Store the PARSED form, not the raw input. `https:\\evil/x` and
	// `https://evil/x` are the same request but different strings; keeping the
	// raw text means the value that was validated is not the value that gets
	// rendered. One canonical form removes that gap.
	return { value: u.href };
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
 *
 * Pass `onlyIfLiveDeveloper` when these ride in a batch behind a PATCH's UPDATE.
 * D1 rolls a batch back on error but NOT on a statement that matched zero rows,
 * so without it a PATCH against a just-archived developer would commit
 * membership changes and then answer 404.
 *
 * The guard is an EXISTS on the developer row rather than SQLite `changes()`:
 * `changes()` reports the previous row-modifying statement, so its meaning
 * depends on where these land in the batch. EXISTS tests the same condition the
 * UPDATE itself requires and is order-independent.
 */
export function membershipStatements(
	db: D1Database,
	developerId: string,
	teamIds: readonly string[],
	opts?: { onlyIfLiveDeveloper?: boolean; skipDelete?: boolean },
): D1PreparedStatement[] {
	const live = opts?.onlyIfLiveDeveloper
		? ` AND EXISTS (
             SELECT 1 FROM developers WHERE id = ?1 AND archived_at IS NULL
           )`
		: "";
	// On create the row is brand new, so there is nothing to delete — and that
	// DELETE would spend one of D1's per-invocation statements matching zero
	// rows on every single create.
	const stmts = opts?.skipDelete
		? []
		: [
				db
					.prepare(`DELETE FROM developer_teams WHERE developer_id = ?1${live}`)
					.bind(developerId),
			];
	for (const teamId of teamIds) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO developer_teams (developer_id, team_id, created_at)
           SELECT ?1, ?2, unixepoch()
           WHERE EXISTS (
             SELECT 1 FROM teams WHERE id = ?2 AND archived_at IS NULL
           )${live}`,
				)
				.bind(developerId, teamId),
		);
	}
	return stmts;
}
