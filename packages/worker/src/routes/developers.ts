import type { Context } from "hono";
import {
	archiveDeveloperBatch,
	batchChanges,
	type DeveloperRow,
	membershipStatements,
	newId,
	normalizeAlias,
	normalizeAvatarUrl,
	normalizeName,
	readTeamIds,
	restoreDeveloperBatch,
	staleBumpStatements,
} from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";

function mapDev(r: DeveloperRow, teamIds: string[] = []) {
	return {
		id: r.id,
		name: r.name,
		alias: r.alias,
		avatarUrl: r.avatar_url,
		teamIds,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

/** `developerId → teamIds`, in one query rather than one per developer. */
async function teamsByDeveloper(
	db: D1Database,
): Promise<Map<string, string[]>> {
	const res = await db
		.prepare(
			`SELECT dt.developer_id AS d, dt.team_id AS t
       FROM developer_teams dt
       JOIN teams te ON te.id = dt.team_id AND te.archived_at IS NULL
       ORDER BY te.name COLLATE NOCASE`,
		)
		.all<{ d: string; t: string }>();
	const out = new Map<string, string[]>();
	for (const row of res.results ?? []) {
		const list = out.get(row.d);
		if (list) {
			list.push(row.t);
		} else {
			out.set(row.d, [row.t]);
		}
	}
	return out;
}

/** The live team ids of one developer, in the same order the list route uses. */
async function teamIdsOf(
	db: D1Database,
	developerId: string,
): Promise<string[]> {
	const res = await db
		.prepare(
			`SELECT dt.team_id AS t
       FROM developer_teams dt
       JOIN teams te ON te.id = dt.team_id AND te.archived_at IS NULL
       WHERE dt.developer_id = ?
       ORDER BY te.name COLLATE NOCASE`,
		)
		.bind(developerId)
		.all<{ t: string }>();
	return (res.results ?? []).map((r) => r.t);
}

export async function developersListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM developers ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM developers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const [res, memberships] = await Promise.all([
		c.env.DB.prepare(sql).all<DeveloperRow>(),
		teamsByDeveloper(c.env.DB),
	]);
	return c.json({
		items: (res.results ?? []).map((r) =>
			mapDev(r, memberships.get(r.id) ?? []),
		),
	});
}

export async function developersCreateRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = asObjectBody(raw.value);
	if (!b) {
		return c.json({ error: "Invalid payload" }, 400);
	}
	const name = normalizeName(b.name);
	const alias = normalizeAlias(b.alias);
	if (!name || !alias) {
		return c.json({ error: "name and alias required" }, 400);
	}
	const avatar = normalizeAvatarUrl(b.avatarUrl);
	if ("error" in avatar) {
		return c.json({ error: avatar.error }, 400);
	}
	const teamIds = readTeamIds(b.teamIds);
	if ("error" in teamIds) {
		return c.json({ error: teamIds.error }, 400);
	}

	const id = newId();
	try {
		// INSERT + memberships + atomic CAST(+1) version bump in ONE batch. Split
		// across calls, a failure between them would leave a developer with no
		// teams and no bump — visible to nobody until the numbers looked wrong.
		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO developers (id, name, alias, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
			).bind(id, name, alias, "absent" in avatar ? null : avatar.value),
			// On create, "absent" and "[]" mean the same thing: no memberships.
			// The distinction only matters for PATCH, where absent must not wipe.
			...membershipStatements(
				c.env.DB,
				id,
				"absent" in teamIds ? [] : teamIds.value,
			),
			...staleBumpStatements(c.env.DB, "developer created (match set)"),
		]);
	} catch {
		return c.json({ error: "Alias already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM developers WHERE id = ?`)
		.bind(id)
		.first<DeveloperRow>();
	return c.json(
		mapDev(row as DeveloperRow, await teamIdsOf(c.env.DB, id)),
		201,
	);
}

export async function developersPatchRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "Not found" }, 404);
	}
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = asObjectBody(raw.value);
	if (!b) {
		return c.json({ error: "Invalid payload" }, 400);
	}
	const renaming = b.name !== undefined;
	const name = renaming ? normalizeName(b.name) : null;
	if (renaming && !name) {
		return c.json({ error: "Invalid name or alias" }, 400);
	}
	const realiasing = b.alias !== undefined;
	const alias = realiasing ? normalizeAlias(b.alias) : null;
	if (realiasing && !alias) {
		return c.json({ error: "Invalid name or alias" }, 400);
	}

	const avatar = normalizeAvatarUrl(b.avatarUrl);
	if ("error" in avatar) {
		return c.json({ error: avatar.error }, 400);
	}
	const teamIds = readTeamIds(b.teamIds);
	if ("error" in teamIds) {
		return c.json({ error: teamIds.error }, 400);
	}
	const keepAvatar = "absent" in avatar;

	// Every field is written conditionally in SQL, and nothing is read first.
	//
	// The earlier version pre-read the row and wrote all three scalars back,
	// which lost concurrent updates: an avatar-only PATCH racing an alias-only
	// PATCH would copy its stale avatar over the other's write, and both would
	// answer 200. Touching only the columns the request actually named makes
	// concurrent edits to different fields compose instead of clobber.
	const update = c.env.DB.prepare(
		`UPDATE developers
     SET name = CASE WHEN ?1 = 1 THEN ?2 ELSE name END,
         alias = CASE WHEN ?3 = 1 THEN ?4 ELSE alias END,
         avatar_url = CASE WHEN ?5 = 1 THEN avatar_url ELSE ?6 END,
         updated_at = unixepoch()
     WHERE id = ?7 AND archived_at IS NULL`,
	).bind(
		renaming ? 1 : 0,
		name,
		realiasing ? 1 : 0,
		alias,
		keepAvatar ? 1 : 0,
		keepAvatar ? null : avatar.value,
		id,
	);

	// Whether the alias actually MOVED is decided in SQL too, for the same
	// reason: comparing against a pre-read value can bump for a no-op rename,
	// or miss a real one that landed in between.
	const aliasMayChange = realiasing;
	const memberships =
		"absent" in teamIds
			? []
			: membershipStatements(c.env.DB, id, teamIds.value, {
					onlyIfLiveDeveloper: true,
				});

	try {
		// D1 does NOT roll a batch back when a statement matches zero rows — it
		// only rolls back on error. So every dependent statement carries its own
		// guard; otherwise a PATCH against a row archived a moment ago would
		// commit memberships and a version bump and then answer 404.
		//
		// The guards test the developer row directly rather than SQLite
		// `changes()`, which reports whichever statement ran last and so would
		// silently change meaning if these were ever reordered.
		const results = await c.env.DB.batch([
			update,
			...memberships,
			...(aliasMayChange
				? staleBumpStatements(c.env.DB, "developer.alias updated", {
						onlyIfLive: { table: "developers", id },
					})
				: []),
		]);
		if (!results[0]?.meta?.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Alias already exists" }, 409);
	}

	const row = await c.env.DB.prepare(`SELECT * FROM developers WHERE id = ?`)
		.bind(id)
		.first<DeveloperRow>();
	if (!row || row.archived_at !== null) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json(mapDev(row, await teamIdsOf(c.env.DB, id)));
}

export async function developersArchiveRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "Missing id" }, 400);
	}
	// Single batch: archive + version bump gated on SQLite changes()
	const results = await c.env.DB.batch(archiveDeveloperBatch(c.env.DB, id));
	if (batchChanges(results[0]) === 0) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json({ ok: true });
}

export async function developersRestoreRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "Missing id" }, 400);
	}
	try {
		const results = await c.env.DB.batch(restoreDeveloperBatch(c.env.DB, id));
		if (batchChanges(results[0]) === 0) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Alias conflict with active developer" }, 409);
	}
	return c.json({ ok: true });
}
