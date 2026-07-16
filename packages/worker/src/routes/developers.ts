import type { Context } from "hono";
import {
	bumpConfigStale,
	type DeveloperRow,
	newId,
	normalizeAlias,
	normalizeName,
} from "../lib/entities.js";
import type { AppEnv } from "../types.js";

function mapDev(r: DeveloperRow) {
	return {
		id: r.id,
		name: r.name,
		alias: r.alias,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

export async function developersListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM developers ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM developers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const res = await c.env.DB.prepare(sql).all<DeveloperRow>();
	return c.json({ items: (res.results ?? []).map(mapDev) });
}

export async function developersCreateRoute(c: Context<AppEnv>) {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = body as Record<string, unknown>;
	const name = normalizeName(b.name);
	const alias = normalizeAlias(b.alias);
	if (!name || !alias) {
		return c.json({ error: "name and alias required" }, 400);
	}
	const id = newId();
	try {
		await c.env.DB.prepare(
			`INSERT INTO developers (id, name, alias, created_at, updated_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())`,
		)
			.bind(id, name, alias)
			.run();
	} catch {
		return c.json({ error: "Alias already exists" }, 409);
	}
	await bumpConfigStale(c.env.DB, "developer created (match set)");
	const row = await c.env.DB.prepare(`SELECT * FROM developers WHERE id = ?`)
		.bind(id)
		.first<DeveloperRow>();
	return c.json(mapDev(row as DeveloperRow), 201);
}

export async function developersPatchRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const existing = await c.env.DB.prepare(
		`SELECT * FROM developers WHERE id = ?`,
	)
		.bind(id)
		.first<DeveloperRow>();
	if (!existing || existing.archived_at !== null) {
		return c.json({ error: "Not found" }, 404);
	}

	const b = body as Record<string, unknown>;
	const name = b.name !== undefined ? normalizeName(b.name) : existing.name;
	const alias =
		b.alias !== undefined ? normalizeAlias(b.alias) : existing.alias;
	if (!name || !alias) {
		return c.json({ error: "Invalid name or alias" }, 400);
	}

	const aliasChanged = alias !== existing.alias;
	try {
		await c.env.DB.prepare(
			`UPDATE developers SET name = ?, alias = ?, updated_at = unixepoch() WHERE id = ? AND archived_at IS NULL`,
		)
			.bind(name, alias, id)
			.run();
	} catch {
		return c.json({ error: "Alias already exists" }, 409);
	}

	if (aliasChanged) {
		await bumpConfigStale(c.env.DB, "developer.alias updated");
	}

	const row = await c.env.DB.prepare(`SELECT * FROM developers WHERE id = ?`)
		.bind(id)
		.first<DeveloperRow>();
	return c.json(mapDev(row as DeveloperRow));
}

export async function developersArchiveRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	const r = await c.env.DB.prepare(
		`UPDATE developers SET archived_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND archived_at IS NULL`,
	)
		.bind(id)
		.run();
	if (!r.meta.changes) {
		return c.json({ error: "Not found" }, 404);
	}
	await bumpConfigStale(c.env.DB, "developer archived");
	return c.json({ ok: true });
}

export async function developersRestoreRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	try {
		const r = await c.env.DB.prepare(
			`UPDATE developers SET archived_at = NULL, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NOT NULL`,
		)
			.bind(id)
			.run();
		if (!r.meta.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Alias conflict with active developer" }, 409);
	}
	await bumpConfigStale(c.env.DB, "developer restored");
	return c.json({ ok: true });
}
