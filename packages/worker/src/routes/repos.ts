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

/**
 * Parse projectExternalId: missing → undefined, null/"" → null, string → trim,
 * non-string → error (never silently coerce to null).
 */
function parseProjectExternalId(
	value: unknown,
	keyPresent: boolean,
):
	| { ok: true; value: string | null | undefined }
	| { ok: false; error: string } {
	if (!keyPresent) {
		return { ok: true, value: undefined };
	}
	if (value === null) {
		return { ok: true, value: null };
	}
	if (typeof value !== "string") {
		return {
			ok: false,
			error: "projectExternalId must be a string or null",
		};
	}
	const t = value.trim();
	return { ok: true, value: t.length > 0 ? t : null };
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
	const pe = parseProjectExternalId(
		b.projectExternalId,
		Object.hasOwn(b, "projectExternalId"),
	);
	if (!pe.ok) {
		return { error: pe.error };
	}
	// Missing key → null on create; patch merges before parse
	const resolvedProjectExternalId = pe.value === undefined ? null : pe.value;
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
 * Atomic project GUID consistency: no sibling (incl. archived) may hold a
 * different non-null project_external_id under the same (provider, org, project).
 * Enforced in the same SQL statement as write to close TOCTOU races.
 */
const GUID_OK = `(
  ? IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM repos AS sibling
    WHERE sibling.provider = ?
      AND sibling.org = ?
      AND sibling.project = ?
      AND sibling.project_external_id IS NOT NULL
      AND sibling.project_external_id != ?
      AND sibling.id != ?
  )
)`;

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
	const id = newId();
	try {
		const r = await c.env.DB.prepare(
			`INSERT INTO repos (id, provider, org, project, name, remote_url, external_id, project_external_id, enabled, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch()
       WHERE ${GUID_OK}`,
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
				// GUID_OK binds: newGuid, provider, org, project, newGuid, excludeId
				parsed.projectExternalId,
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.projectExternalId,
				id,
			)
			.run();
		if (!r.meta.changes) {
			return c.json(
				{
					error: "Project GUID conflict",
					message:
						"Another repo under this (provider, org, project) already has a different project_external_id",
				},
				409,
			);
		}
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
	if (
		Object.hasOwn(b, "projectExternalId") &&
		b.projectExternalId !== null &&
		typeof b.projectExternalId !== "string"
	) {
		return c.json({ error: "projectExternalId must be a string or null" }, 400);
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
	try {
		const r = await c.env.DB.prepare(
			`UPDATE repos SET provider = ?, org = ?, project = ?, name = ?, remote_url = ?, external_id = ?, project_external_id = ?, enabled = ?, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NULL
         AND ${GUID_OK}`,
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
				// GUID_OK
				parsed.projectExternalId,
				parsed.provider,
				parsed.org,
				parsed.project,
				parsed.projectExternalId,
				id,
			)
			.run();
		if (!r.meta.changes) {
			return c.json(
				{
					error: "Project GUID conflict",
					message:
						"Another repo under this (provider, org, project) already has a different project_external_id",
				},
				409,
			);
		}
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
	const existing = await c.env.DB.prepare(`SELECT * FROM repos WHERE id = ?`)
		.bind(id)
		.first<RepoRow>();
	if (!existing || existing.archived_at === null) {
		return c.json({ error: "Not found" }, 404);
	}
	try {
		// Atomic: only clear archived_at if no sibling holds a different GUID.
		const r = await c.env.DB.prepare(
			`UPDATE repos SET archived_at = NULL, updated_at = unixepoch()
       WHERE id = ? AND archived_at IS NOT NULL
         AND (
           project_external_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM repos AS sibling
             WHERE sibling.provider = repos.provider
               AND sibling.org = repos.org
               AND sibling.project = repos.project
               AND sibling.id != repos.id
               AND sibling.project_external_id IS NOT NULL
               AND sibling.project_external_id != repos.project_external_id
           )
         )`,
		)
			.bind(id)
			.run();
		if (!r.meta.changes) {
			return c.json(
				{
					error: "Project GUID conflict",
					message:
						"Cannot restore: another repo under this (provider, org, project) has a different project_external_id",
				},
				409,
			);
		}
	} catch {
		return c.json({ error: "Conflict restoring repo" }, 409);
	}
	return c.json({ ok: true });
}
