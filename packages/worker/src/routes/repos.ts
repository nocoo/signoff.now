import type { Context } from "hono";
import { newId, normalizeName, type RepoRow } from "../lib/entities.js";
import { asObjectBody, readJsonBody } from "../lib/http-body.js";
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
		projectExternalId: r.project_external_id,
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

function parseProjectExternalId(value: unknown): string | null | undefined {
	if (value === undefined) {
		return;
	}
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return;
	}
	const t = value.trim();
	return t.length > 0 ? t : null;
}

function parseRepoBody(body: unknown) {
	const b = asObjectBody(body);
	if (!b) {
		return null;
	}
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
	const projectExternalId = parseProjectExternalId(b.projectExternalId);
	// Missing key → null on create; patch merges before parse
	const resolvedProjectExternalId =
		projectExternalId === undefined ? null : projectExternalId;
	const enabled = b.enabled === false ? 0 : 1;
	if (provider === "ado" && enabled === 1 && !externalId) {
		return { error: "ADO enabled repos require externalId (repository GUID)" };
	}
	return {
		provider,
		org,
		project,
		name,
		remoteUrl,
		externalId,
		projectExternalId: resolvedProjectExternalId,
		enabled,
	};
}

/**
 * Hard-reject inconsistent non-null project GUID under the same
 * (provider, org, project). Same GUID or null is allowed.
 */
async function assertProjectGuidConsistent(
	db: D1Database,
	opts: {
		provider: string;
		org: string;
		project: string;
		projectExternalId: string | null;
		excludeId?: string;
	},
): Promise<{ ok: true } | { ok: false; existing: string }> {
	if (!opts.projectExternalId) {
		return { ok: true };
	}
	const row = await db
		.prepare(
			`SELECT project_external_id FROM repos
       WHERE provider = ? AND org = ? AND project = ?
         AND project_external_id IS NOT NULL
         AND project_external_id != ?
         AND archived_at IS NULL
         ${opts.excludeId ? "AND id != ?" : ""}
       LIMIT 1`,
		)
		.bind(
			...(opts.excludeId
				? [
						opts.provider,
						opts.org,
						opts.project,
						opts.projectExternalId,
						opts.excludeId,
					]
				: [opts.provider, opts.org, opts.project, opts.projectExternalId]),
		)
		.first<{ project_external_id: string }>();
	if (row?.project_external_id) {
		return { ok: false, existing: row.project_external_id };
	}
	return { ok: true };
}

export async function reposCreateRoute(c: Context<AppEnv>) {
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const parsed = parseRepoBody(raw.value);
	if (!parsed || "error" in parsed) {
		return c.json(
			{ error: parsed && "error" in parsed ? parsed.error : "Invalid body" },
			400,
		);
	}
	const guidCheck = await assertProjectGuidConsistent(c.env.DB, {
		provider: parsed.provider,
		org: parsed.org,
		project: parsed.project,
		projectExternalId: parsed.projectExternalId,
	});
	if (!guidCheck.ok) {
		return c.json(
			{
				error: "Project GUID conflict",
				message: `Existing project_external_id for this (provider, org, project) is ${guidCheck.existing}`,
				existing: guidCheck.existing,
			},
			409,
		);
	}
	const id = newId();
	try {
		await c.env.DB.prepare(
			`INSERT INTO repos (id, provider, org, project, name, remote_url, external_id, project_external_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
		)
			.bind(
				id,
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.name,
				parsed.remoteUrl,
				parsed.externalId,
				parsed.projectExternalId,
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
	const raw = await readJsonBody(c);
	if (!raw.ok) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const b = asObjectBody(raw.value);
	if (!b) {
		return c.json({ error: "Invalid payload" }, 400);
	}
	const merged = {
		provider: typeof b.provider === "string" ? b.provider : existing.provider,
		org: b.org !== undefined ? b.org : existing.org,
		project: b.project !== undefined ? b.project : existing.project,
		name: b.name !== undefined ? b.name : existing.name,
		remoteUrl: b.remoteUrl !== undefined ? b.remoteUrl : existing.remote_url,
		externalId:
			b.externalId !== undefined ? b.externalId : existing.external_id,
		projectExternalId:
			b.projectExternalId !== undefined
				? b.projectExternalId
				: existing.project_external_id,
		enabled: b.enabled !== undefined ? b.enabled : existing.enabled === 1,
	};
	const parsed = parseRepoBody(merged);
	if (!parsed || "error" in parsed) {
		return c.json(
			{ error: parsed && "error" in parsed ? parsed.error : "Invalid body" },
			400,
		);
	}
	const guidCheck = await assertProjectGuidConsistent(c.env.DB, {
		provider: parsed.provider,
		org: parsed.org,
		project: parsed.project,
		projectExternalId: parsed.projectExternalId,
		excludeId: id,
	});
	if (!guidCheck.ok) {
		return c.json(
			{
				error: "Project GUID conflict",
				message: `Existing project_external_id for this (provider, org, project) is ${guidCheck.existing}`,
				existing: guidCheck.existing,
			},
			409,
		);
	}
	try {
		await c.env.DB.prepare(
			`UPDATE repos SET provider = ?, org = ?, project = ?, name = ?, remote_url = ?, external_id = ?, project_external_id = ?, enabled = ?, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NULL`,
		)
			.bind(
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.name,
				parsed.remoteUrl,
				parsed.externalId,
				parsed.projectExternalId,
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
