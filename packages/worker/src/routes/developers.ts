import type { Context } from "hono";
import {
	archiveDeveloperBatch,
	batchChanges,
	type DeveloperRow,
	LINK_TABLES,
	linkStatements,
	newId,
	normalizeAlias,
	normalizeAvatarUrl,
	normalizeName,
	readIdList,
	restoreDeveloperBatch,
	staleBumpStatements,
} from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";

function mapDev(
	r: DeveloperRow,
	teamIds: string[] = [],
	tagIds: string[] = [],
) {
	return {
		id: r.id,
		name: r.name,
		alias: r.alias,
		avatarUrl: r.avatar_url,
		teamIds,
		tagIds,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

/** `developerId → linked ids`, in one query rather than one per developer. */
async function linksByDeveloper(
	db: D1Database,
	kind: "developerTeams" | "developerTags",
): Promise<Map<string, string[]>> {
	const t = LINK_TABLES[kind];
	const res = await db
		.prepare(
			`SELECT l.${t.ownerCol} AS d, l.${t.targetCol} AS t
       FROM ${t.table} l
       JOIN ${t.targetTable} x ON x.id = l.${t.targetCol} AND x.archived_at IS NULL
       ORDER BY x.name COLLATE NOCASE`,
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

/** The live linked ids of one developer, ordered as the list route orders them. */
async function linkIdsOf(
	db: D1Database,
	kind: "developerTeams" | "developerTags",
	developerId: string,
): Promise<string[]> {
	const t = LINK_TABLES[kind];
	const res = await db
		.prepare(
			`SELECT l.${t.targetCol} AS t
       FROM ${t.table} l
       JOIN ${t.targetTable} x ON x.id = l.${t.targetCol} AND x.archived_at IS NULL
       WHERE l.${t.ownerCol} = ?
       ORDER BY x.name COLLATE NOCASE`,
		)
		.bind(developerId)
		.all<{ t: string }>();
	return (res.results ?? []).map((r) => r.t);
}

/** Both link sets for one developer, fetched together. */
async function linksOf(
	db: D1Database,
	developerId: string,
): Promise<[string[], string[]]> {
	return Promise.all([
		linkIdsOf(db, "developerTeams", developerId),
		linkIdsOf(db, "developerTags", developerId),
	]);
}

export async function developersListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM developers ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM developers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const [res, teams, tags] = await Promise.all([
		c.env.DB.prepare(sql).all<DeveloperRow>(),
		linksByDeveloper(c.env.DB, "developerTeams"),
		linksByDeveloper(c.env.DB, "developerTags"),
	]);
	return c.json({
		items: (res.results ?? []).map((r) =>
			mapDev(r, teams.get(r.id) ?? [], tags.get(r.id) ?? []),
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
	const teamIds = readIdList(b.teamIds, "teamIds");
	if ("error" in teamIds) {
		return c.json({ error: teamIds.error }, 400);
	}
	const tagIds = readIdList(b.tagIds, "tagIds");
	if ("error" in tagIds) {
		return c.json({ error: tagIds.error }, 400);
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
			// `skipDelete`: the row was created by the statement above, so there
			// is nothing to clear.
			...linkStatements(
				c.env.DB,
				"developerTeams",
				id,
				"absent" in teamIds ? [] : teamIds.value,
				{ skipDelete: true },
			),
			...linkStatements(
				c.env.DB,
				"developerTags",
				id,
				"absent" in tagIds ? [] : tagIds.value,
				{ skipDelete: true },
			),
			...staleBumpStatements(c.env.DB, "developer created (match set)"),
		]);
	} catch {
		return c.json({ error: "Alias already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM developers WHERE id = ?`)
		.bind(id)
		.first<DeveloperRow>();
	const [teams, tags] = await linksOf(c.env.DB, id);
	return c.json(mapDev(row as DeveloperRow, teams, tags), 201);
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
	const teamIds = readIdList(b.teamIds, "teamIds");
	if ("error" in teamIds) {
		return c.json({ error: teamIds.error }, 400);
	}
	const tagIds = readIdList(b.tagIds, "tagIds");
	if ("error" in tagIds) {
		return c.json({ error: tagIds.error }, 400);
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
	const links = [
		...("absent" in teamIds
			? []
			: linkStatements(c.env.DB, "developerTeams", id, teamIds.value, {
					onlyIfLiveOwner: true,
				})),
		...("absent" in tagIds
			? []
			: linkStatements(c.env.DB, "developerTags", id, tagIds.value, {
					onlyIfLiveOwner: true,
				})),
	];

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
			...links,
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
	const [teams, tags] = await linksOf(c.env.DB, id);
	return c.json(mapDev(row, teams, tags));
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
