import type { Context } from "hono";
import {
	newId,
	normalizeColor,
	normalizeName,
	type TagRow,
} from "../lib/entities.js";
import type { AppEnv } from "../types.js";

function mapTag(r: TagRow) {
	return {
		id: r.id,
		name: r.name,
		color: r.color,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

export async function tagsListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM tags ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM tags WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const res = await c.env.DB.prepare(sql).all<TagRow>();
	return c.json({ items: (res.results ?? []).map(mapTag) });
}

export async function tagsCreateRoute(c: Context<AppEnv>) {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = body as Record<string, unknown>;
	const name = normalizeName(b.name);
	const color = normalizeColor(b.color ?? "#3B82F6");
	if (!name || !color) {
		return c.json({ error: "name and color (#RRGGBB) required" }, 400);
	}
	const id = newId();
	try {
		await c.env.DB.prepare(
			`INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())`,
		)
			.bind(id, name, color)
			.run();
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM tags WHERE id = ?`)
		.bind(id)
		.first<TagRow>();
	return c.json(mapTag(row as TagRow), 201);
}

export async function tagsPatchRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const existing = await c.env.DB.prepare(`SELECT * FROM tags WHERE id = ?`)
		.bind(id)
		.first<TagRow>();
	if (!existing || existing.archived_at !== null) {
		return c.json({ error: "Not found" }, 404);
	}
	const b = body as Record<string, unknown>;
	const name = b.name !== undefined ? normalizeName(b.name) : existing.name;
	const color =
		b.color !== undefined ? normalizeColor(b.color) : existing.color;
	if (!name || !color) {
		return c.json({ error: "Invalid name or color" }, 400);
	}
	try {
		await c.env.DB.prepare(
			`UPDATE tags SET name = ?, color = ?, updated_at = unixepoch() WHERE id = ? AND archived_at IS NULL`,
		)
			.bind(name, color, id)
			.run();
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM tags WHERE id = ?`)
		.bind(id)
		.first<TagRow>();
	return c.json(mapTag(row as TagRow));
}

export async function tagsArchiveRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	const r = await c.env.DB.prepare(
		`UPDATE tags SET archived_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND archived_at IS NULL`,
	)
		.bind(id)
		.run();
	if (!r.meta.changes) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json({ ok: true });
}

export async function tagsRestoreRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	try {
		const r = await c.env.DB.prepare(
			`UPDATE tags SET archived_at = NULL, updated_at = unixepoch()
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
