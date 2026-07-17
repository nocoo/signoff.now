import type { Context } from "hono";
import { newId, normalizeName, type TeamRow } from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";

function mapTeam(r: TeamRow) {
	return {
		id: r.id,
		name: r.name,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

export async function teamsListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM teams ORDER BY name COLLATE NOCASE`
		: `SELECT * FROM teams WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`;
	const res = await c.env.DB.prepare(sql).all<TeamRow>();
	return c.json({ items: (res.results ?? []).map(mapTeam) });
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
	const id = newId();
	try {
		await c.env.DB.prepare(
			`INSERT INTO teams (id, name, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())`,
		)
			.bind(id, name)
			.run();
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ?`)
		.bind(id)
		.first<TeamRow>();
	return c.json(mapTeam(row as TeamRow), 201);
}

export async function teamsPatchRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
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
	try {
		const r = await c.env.DB.prepare(
			`UPDATE teams SET name = ?, updated_at = unixepoch() WHERE id = ? AND archived_at IS NULL`,
		)
			.bind(name, id)
			.run();
		if (!r.meta.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Name already exists" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM teams WHERE id = ?`)
		.bind(id)
		.first<TeamRow>();
	return c.json(mapTeam(row as TeamRow));
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
