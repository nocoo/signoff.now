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
	const existing = await c.env.DB.prepare(
		`SELECT * FROM developers WHERE id = ?`,
	)
		.bind(id)
		.first<DeveloperRow>();
	if (!existing || existing.archived_at !== null) {
		return c.json({ error: "Not found" }, 404);
	}

	const name = b.name !== undefined ? normalizeName(b.name) : existing.name;
	const alias =
		b.alias !== undefined ? normalizeAlias(b.alias) : existing.alias;
	if (!name || !alias) {
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
	const avatarUrl = "absent" in avatar ? existing.avatar_url : avatar.value;

	// Only an alias change bumps the config version: it moves the identity
	// MATCH SET, so every historical score has to be recomputed. A new avatar
	// or a team reshuffle changes nothing about who owns which activity, and
	// bumping for those would force a full rematch over a picture.
	const aliasChanged = alias !== existing.alias;
	const update = c.env.DB.prepare(
		`UPDATE developers SET name = ?, alias = ?, avatar_url = ?, updated_at = unixepoch()
     WHERE id = ? AND archived_at IS NULL`,
	).bind(name, alias, avatarUrl, id);
	const memberships =
		"absent" in teamIds
			? []
			: membershipStatements(c.env.DB, id, teamIds.value);

	try {
		if (aliasChanged || memberships.length > 0) {
			const results = await c.env.DB.batch([
				update,
				...memberships,
				...(aliasChanged
					? staleBumpStatements(c.env.DB, "developer.alias updated")
					: []),
			]);
			if (!results[0]?.meta?.changes) {
				return c.json({ error: "Not found" }, 404);
			}
		} else {
			const r = await update.run();
			if (!r.meta.changes) {
				return c.json({ error: "Not found" }, 404);
			}
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
