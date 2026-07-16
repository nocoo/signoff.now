import type { Context } from "hono";
import { newId, normalizeName, type RepoRow } from "../lib/entities.js";
import type { AppEnv } from "../types.js";

function mapRepo(r: RepoRow) {
	return {
		id: r.id,
		provider: r.provider,
		org: r.org,
		project: r.project,
		name: r.name,
		remoteUrl: r.remote_url,
		externalId: r.external_id,
		enabled: r.enabled === 1,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		archivedAt: r.archived_at,
	};
}

export async function reposListRoute(c: Context<AppEnv>) {
	const includeArchived = c.req.query("includeArchived") === "1";
	const sql = includeArchived
		? `SELECT * FROM repos ORDER BY org, project, name`
		: `SELECT * FROM repos WHERE archived_at IS NULL ORDER BY org, project, name`;
	const res = await c.env.DB.prepare(sql).all<RepoRow>();
	return c.json({ items: (res.results ?? []).map(mapRepo) });
}

function parseRepoBody(body: unknown) {
	if (!body || typeof body !== "object") {
		return null;
	}
	const b = body as Record<string, unknown>;
	const provider = typeof b.provider === "string" ? b.provider : "ado";
	if (provider !== "ado" && provider !== "github") {
		return null;
	}
	const org = normalizeName(b.org);
	const project = normalizeName(b.project);
	const name = normalizeName(b.name);
	if (!org || !project || !name) {
		return null;
	}
	const remoteUrl =
		typeof b.remoteUrl === "string" || b.remoteUrl === null
			? (b.remoteUrl as string | null)
			: null;
	const externalId =
		typeof b.externalId === "string" && b.externalId.trim()
			? b.externalId.trim()
			: null;
	const enabled = b.enabled === false ? 0 : 1;
	if (provider === "ado" && enabled === 1 && !externalId) {
		return { error: "ADO enabled repos require externalId (repository GUID)" };
	}
	return { provider, org, project, name, remoteUrl, externalId, enabled };
}

export async function reposCreateRoute(c: Context<AppEnv>) {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const parsed = parseRepoBody(body);
	if (!parsed || "error" in parsed) {
		return c.json(
			{ error: parsed && "error" in parsed ? parsed.error : "Invalid body" },
			400,
		);
	}
	const id = newId();
	try {
		await c.env.DB.prepare(
			`INSERT INTO repos (id, provider, org, project, name, remote_url, external_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
		)
			.bind(
				id,
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.name,
				parsed.remoteUrl,
				parsed.externalId,
				parsed.enabled,
			)
			.run();
	} catch {
		return c.json({ error: "Conflict (name or external_id)" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM repos WHERE id = ?`)
		.bind(id)
		.first<RepoRow>();
	return c.json(mapRepo(row as RepoRow), 201);
}

export async function reposPatchRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	const existing = await c.env.DB.prepare(`SELECT * FROM repos WHERE id = ?`)
		.bind(id)
		.first<RepoRow>();
	if (!existing || existing.archived_at !== null) {
		return c.json({ error: "Not found" }, 404);
	}
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = body as Record<string, unknown>;
	const merged = {
		provider: typeof b.provider === "string" ? b.provider : existing.provider,
		org: b.org !== undefined ? b.org : existing.org,
		project: b.project !== undefined ? b.project : existing.project,
		name: b.name !== undefined ? b.name : existing.name,
		remoteUrl: b.remoteUrl !== undefined ? b.remoteUrl : existing.remote_url,
		externalId:
			b.externalId !== undefined ? b.externalId : existing.external_id,
		enabled: b.enabled !== undefined ? b.enabled : existing.enabled === 1,
	};
	const parsed = parseRepoBody(merged);
	if (!parsed || "error" in parsed) {
		return c.json(
			{ error: parsed && "error" in parsed ? parsed.error : "Invalid body" },
			400,
		);
	}
	try {
		await c.env.DB.prepare(
			`UPDATE repos SET provider = ?, org = ?, project = ?, name = ?, remote_url = ?, external_id = ?, enabled = ?, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NULL`,
		)
			.bind(
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.name,
				parsed.remoteUrl,
				parsed.externalId,
				parsed.enabled,
				id,
			)
			.run();
	} catch {
		return c.json({ error: "Conflict (name or external_id)" }, 409);
	}
	const row = await c.env.DB.prepare(`SELECT * FROM repos WHERE id = ?`)
		.bind(id)
		.first<RepoRow>();
	return c.json(mapRepo(row as RepoRow));
}

export async function reposArchiveRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	const r = await c.env.DB.prepare(
		`UPDATE repos SET archived_at = unixepoch(), updated_at = unixepoch(), enabled = 0
     WHERE id = ? AND archived_at IS NULL`,
	)
		.bind(id)
		.run();
	if (!r.meta.changes) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json({ ok: true });
}

export async function reposRestoreRoute(c: Context<AppEnv>) {
	const id = c.req.param("id");
	try {
		const r = await c.env.DB.prepare(
			`UPDATE repos SET archived_at = NULL, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NOT NULL`,
		)
			.bind(id)
			.run();
		if (!r.meta.changes) {
			return c.json({ error: "Not found" }, 404);
		}
	} catch {
		return c.json({ error: "Conflict restoring repo" }, 409);
	}
	return c.json({ ok: true });
}
