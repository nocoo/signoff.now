import type { Context } from "hono";
import {
	LINK_TABLES,
	linkStatements,
	newId,
	normalizeAvatarUrl,
	normalizeName,
	readIdList,
	type TeamRow,
} from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";

function mapTeam(r: TeamRow, tagIds: string[] = []) {
	return {
		id: r.id,
		name: r.name,
		avatarUrl: r.avatar_url,
		tagIds,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

/** `teamId → tagIds`, in one query rather than one per team. */
async function tagsByTeam(db: D1Database): Promise<Map<string, string[]>> {
	const t = LINK_TABLES.teamTags;
	const res = await db
		.prepare(
			`SELECT l.${t.ownerCol} AS o, l.${t.targetCol} AS g
       FROM ${t.table} l
       JOIN tags x ON x.id = l.${t.targetCol} AND x.archived_at IS NULL
       ORDER BY x.name COLLATE NOCASE`,
		)
		.all<{ o: string; g: string }>();
	const out = new Map<string, string[]>();
	for (const row of res.results ?? []) {
		const list = out.get(row.o);
		if (list) {
			list.push(row.g);
		} else {
			out.set(row.o, [row.g]);
		}
	}
	return out;
}

/** The live tag ids of one team, ordered as the list route orders them. */
async function tagIdsOf(db: D1Database, teamId: string): Promise<string[]> {
	const t = LINK_TABLES.teamTags;
	const res = await db
		.prepare(
			`SELECT l.${t.targetCol} AS g
       FROM ${t.table} l
       JOIN tags x ON x.id = l.${t.targetCol} AND x.archived_at IS NULL
       WHERE l.${t.ownerCol} = ?
       ORDER BY x.name COLLATE NOCASE`,
		)
		.bind(teamId)
		.all<{ g: string }>();
	return (res.results ?? []).map((r) => r.g);
}

export async function teamsListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM teams ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM teams WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const [res, tags] = await Promise.all([
		c.env.DB.prepare(sql).all<TeamRow>(),
		tagsByTeam(c.env.DB),
	]);
	return c.json({
		items: (res.results ?? []).map((r) => mapTeam(r, tags.get(r.id) ?? [])),
	});
}

export async function teamsCreateRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = asObjectBody(raw.value);
	if (!b) {
		return c.json({ error: "Invalid payload" }, 400);
	}
	const name = normalizeName(b.name);
	if (!name) {
		return c.json({ error: "name required" }, 400);
	}
	const avatar = normalizeAvatarUrl(b.avatarUrl);
	if ("error" in avatar) {
		return c.json({ error: avatar.error }, 400);
	}
	const tagIds = readIdList(b.tagIds, "tagIds");
	if ("error" in tagIds) {
		return c.json({ error: tagIds.error }, 400);
	}
	const id = newId();
	try {
		// INSERT + tag links in ONE batch: split across calls, a failure between
		// them would leave a team whose tags silently vanished.
		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO teams (id, name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, unixepoch(), unixepoch())`,
			).bind(id, name, "absent" in avatar ? null : avatar.value),
			// `skipDelete`: the row was created by the statement above.
			...linkStatements(
				c.env.DB,
				"teamTags",
				id,
				"absent" in tagIds ? [] : tagIds.value,
				{ skipDelete: true },
			),
		]);
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ?`)
		.bind(id)
		.first<TeamRow>();
	return c.json(mapTeam(row as TeamRow, await tagIdsOf(c.env.DB, id)), 201);
}

export async function teamsPatchRoute(c: Context<AppEnv>) {
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
	// PATCH is partial on every field, matching the developer route: sending
	// only `avatarUrl` must not be rejected for "name required". A present but
	// blank name is still an error — that is a mistake, not an omission.
	const renaming = b.name !== undefined;
	const name = renaming ? normalizeName(b.name) : null;
	if (renaming && !name) {
		return c.json({ error: "name required" }, 400);
	}
	const avatar = normalizeAvatarUrl(b.avatarUrl);
	if ("error" in avatar) {
		return c.json({ error: avatar.error }, 400);
	}
	const tagIds = readIdList(b.tagIds, "tagIds");
	if ("error" in tagIds) {
		return c.json({ error: tagIds.error }, 400);
	}
	// Keep the stored values when their fields were absent, WITHOUT a second
	// round trip to read them first — and without turning "not found" into a
	// different status than this route already promised.
	const keepAvatar = "absent" in avatar;
	const update = c.env.DB.prepare(
		`UPDATE teams
       SET name = CASE WHEN ?1 = 1 THEN ?2 ELSE name END,
           avatar_url = CASE WHEN ?3 = 1 THEN avatar_url ELSE ?4 END,
           updated_at = unixepoch()
       WHERE id = ?5 AND archived_at IS NULL`,
	).bind(
		renaming ? 1 : 0,
		name,
		keepAvatar ? 1 : 0,
		keepAvatar ? null : avatar.value,
		id,
	);
	// Guarded on the team still being live: D1 does not roll a batch back when
	// a statement matches zero rows, so an unguarded tag write would commit
	// against a team this route is about to report as 404.
	const links =
		"absent" in tagIds
			? []
			: linkStatements(c.env.DB, "teamTags", id, tagIds.value, {
					onlyIfLiveOwner: true,
				});
	try {
		const results = await c.env.DB.batch([update, ...links]);
		if (!results[0]?.meta?.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ?`)
		.bind(id)
		.first<TeamRow>();
	return c.json(mapTeam(row as TeamRow, await tagIdsOf(c.env.DB, id)));
}

export async function teamsArchiveRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	const r = await c.env.DB.prepare(
		`UPDATE teams SET archived_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND archived_at IS NULL`,
	)
		.bind(id)
		.run();
	if (!r.meta.changes) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json({ ok: true });
}

export async function teamsRestoreRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	try {
		const r = await c.env.DB.prepare(
			`UPDATE teams SET archived_at = NULL, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NOT NULL`,
		)
			.bind(id)
			.run();
		if (!r.meta.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Name conflict" }, 409);
	}
	return c.json({ ok: true });
}
