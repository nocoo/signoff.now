import {
	type DataSource,
	type DirectoryData,
	type DirectoryIdentity,
	dataSourceSchema,
	identityKey,
	type MemberDraft,
	memberDraftSchema,
	repositoryKey,
	type TagDraft,
	type TeamDraft,
	tagDraftSchema,
	teamDraftSchema,
} from "@signoff/domain/insights";
import type { Context } from "hono";
import {
	batchChanges,
	type DeveloperRow,
	newId,
	normalizeAvatarUrl,
	staleBumpStatements,
	type TagRow,
	type TeamRow,
} from "../lib/entities";
import { readJsonBodyWithSize } from "../lib/http-body";
import { isLocalhost } from "../middleware/entry-control";
import type { AppEnv } from "../types";
import { mapProject, type ProjectRow } from "./workbench";

type LinkRow = { owner_id: string; target_id: string };
type IdentityRow = {
	provider: "ado" | "github";
	organization: string;
	actor_id: string;
	name: string;
	handle: string | null;
	avatar_url: string | null;
	last_seen_at: number | null;
	developer_id?: string;
};

function safeAvatar(value: string | null): string | null {
	const result = normalizeAvatarUrl(value);
	return "value" in result ? result.value : null;
}

/** This is the observed account catalogue, without the PR workbench's row cap. */
export async function readDirectory(
	db: D1Database,
	source: DataSource,
): Promise<DirectoryData> {
	const queries = [
		"SELECT * FROM developers WHERE source = ? ORDER BY name COLLATE NOCASE, id",
		"SELECT * FROM teams WHERE source = ? ORDER BY name COLLATE NOCASE, id",
		"SELECT * FROM tags WHERE source = ? ORDER BY name COLLATE NOCASE, id",
		"SELECT * FROM projects WHERE source = ? ORDER BY organization, project_key",
		"SELECT * FROM developer_identities WHERE source = ? ORDER BY identity_key",
		`WITH ranked AS (
			SELECT p.provider, p.organization, json_extract(pr.snapshot, '$.author.id') AS actor_id,
			json_extract(pr.snapshot, '$.author.name') AS name, json_extract(pr.snapshot, '$.author.handle') AS handle,
			json_extract(pr.snapshot, '$.author.avatarUrl') AS avatar_url, json_extract(pr.snapshot, '$.observedAt') AS last_seen_at,
			ROW_NUMBER() OVER (PARTITION BY p.provider, lower(p.organization), json_extract(pr.snapshot, '$.author.id')
				ORDER BY json_extract(pr.snapshot, '$.observedAt') DESC, pr.id) AS rank
			FROM pull_requests pr JOIN projects p ON p.id = pr.project_id
			WHERE p.source = ? AND json_extract(pr.snapshot, '$.author.id') != 'unknown'
		) SELECT * FROM ranked WHERE rank = 1`,
		`SELECT l.developer_id AS owner_id, l.team_id AS target_id FROM developer_teams l
			JOIN developers d ON d.id = l.developer_id JOIN teams t ON t.id = l.team_id
			WHERE d.source = ? AND t.archived_at IS NULL`,
		`SELECT l.developer_id AS owner_id, l.tag_id AS target_id FROM developer_tags l
			JOIN developers d ON d.id = l.developer_id JOIN tags t ON t.id = l.tag_id
			WHERE d.source = ? AND t.archived_at IS NULL`,
		`SELECT l.team_id AS owner_id, l.tag_id AS target_id FROM team_tags l
			JOIN teams d ON d.id = l.team_id JOIN tags t ON t.id = l.tag_id
			WHERE d.source = ? AND t.archived_at IS NULL`,
		`WITH ranked AS (
			SELECT pr.project_id, pr.repository_id, json_extract(pr.snapshot, '$.repository.name') AS name,
			ROW_NUMBER() OVER (PARTITION BY pr.project_id, pr.repository_id ORDER BY json_extract(pr.snapshot, '$.observedAt') DESC, pr.id) AS rank
			FROM pull_requests pr JOIN projects p ON p.id = pr.project_id WHERE p.source = ?
		) SELECT * FROM ranked WHERE rank = 1 ORDER BY name COLLATE NOCASE`,
		"SELECT revision FROM directory_revisions WHERE source = ?",
	];
	const results = await db.batch(
		queries.map((sql) => db.prepare(sql).bind(source)),
	);
	const rows = <T>(index: number): T[] =>
		(results[index]?.results ?? []) as T[];
	const linked = rows<IdentityRow>(4);
	const identities = new Map<string, DirectoryIdentity>();
	for (const row of [...linked, ...rows<IdentityRow>(5)]) {
		const key = identityKey(row.provider, row.organization, row.actor_id);
		identities.set(key, {
			key,
			provider: row.provider,
			organization: row.organization,
			actorId: row.actor_id,
			name: row.name,
			handle: row.handle,
			avatarUrl: safeAvatar(row.avatar_url),
			lastSeenAt: row.last_seen_at,
			memberId: row.developer_id ?? identities.get(key)?.memberId ?? null,
		});
	}
	const teamLinks = rows<LinkRow>(6);
	const tagLinks = rows<LinkRow>(7);
	const teamTagLinks = rows<LinkRow>(8);
	const targets = (links: LinkRow[], owner: string) =>
		links
			.filter((link) => link.owner_id === owner)
			.map((link) => link.target_id)
			.sort((a, b) => a.localeCompare(b));
	const members = rows<DeveloperRow>(0).map((row) => ({
		id: row.id,
		name: row.name,
		avatarUrl: row.avatar_url,
		archivedAt: row.archived_at,
		teamIds: targets(teamLinks, row.id),
		tagIds: targets(tagLinks, row.id),
		identityKeys: [...identities.values()]
			.filter((identity) => identity.memberId === row.id)
			.map((identity) => identity.key)
			.sort((a, b) => a.localeCompare(b)),
	}));
	return {
		source,
		revision: (rows<{ revision: number }>(10)[0] as { revision: number })
			.revision,
		members,
		teams: rows<TeamRow>(1).map((row) => ({
			id: row.id,
			name: row.name,
			avatarUrl: row.avatar_url,
			archivedAt: row.archived_at,
			memberIds: members
				.filter(
					(member) =>
						member.archivedAt === null && member.teamIds.includes(row.id),
				)
				.map((member) => member.id)
				.sort((a, b) => a.localeCompare(b)),
			tagIds: targets(teamTagLinks, row.id),
		})),
		tags: rows<TagRow>(2).map((row) => ({
			id: row.id,
			name: row.name,
			color: row.color,
			archivedAt: row.archived_at,
		})),
		projects: rows<ProjectRow>(3).map(mapProject),
		identities: [...identities.values()].sort(
			(a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
		),
		repositories: rows<{
			project_id: string;
			repository_id: string;
			name: string;
		}>(9).map((row) => ({
			key: repositoryKey(row.project_id, row.repository_id),
			projectId: row.project_id,
			id: row.repository_id,
			name: row.name,
		})),
	};
}

export async function directoryRoute(c: Context<AppEnv>) {
	const source = dataSourceSchema.safeParse(c.req.query("source") ?? "cli");
	if (!source.success) return c.json({ error: "Invalid data source" }, 400);
	c.header("Cache-Control", "no-store");
	return c.json(await readDirectory(c.env.DB, source.data));
}

const entityTables = {
	members: "developers",
	teams: "teams",
	tags: "tags",
} as const;
type EntityKind = keyof typeof entityTables;
function entityKind(value: string | undefined): EntityKind | null {
	return value === "members" || value === "teams" || value === "tags"
		? value
		: null;
}

function replaceLinks(
	db: D1Database,
	source: DataSource,
	ownerId: string,
	targetIds: string[],
	link: {
		table: string;
		ownerColumn: string;
		ownerTable: string;
		targetColumn: string;
		targetTable: string;
	},
): D1PreparedStatement[] {
	const guard = `EXISTS (SELECT 1 FROM ${link.ownerTable} WHERE id = ?1 AND source = ?2 AND archived_at IS NULL)`;
	return [
		db
			.prepare(
				`DELETE FROM ${link.table} WHERE ${link.ownerColumn} = ?1 AND ${guard}
				AND ${link.targetColumn} IN (SELECT id FROM ${link.targetTable} WHERE source = ?2 AND archived_at IS NULL)`,
			)
			.bind(ownerId, source),
		db
			.prepare(`INSERT INTO ${link.table} (${link.ownerColumn}, ${link.targetColumn})
			SELECT ?1, t.id FROM json_each(?3) j JOIN ${link.targetTable} t ON t.id = j.value
			WHERE t.source = ?2 AND t.archived_at IS NULL AND ${guard}`)
			.bind(ownerId, source, JSON.stringify(targetIds)),
	];
}
const memberTeams = {
	table: "developer_teams",
	ownerColumn: "developer_id",
	ownerTable: "developers",
	targetColumn: "team_id",
	targetTable: "teams",
};
const memberTags = {
	table: "developer_tags",
	ownerColumn: "developer_id",
	ownerTable: "developers",
	targetColumn: "tag_id",
	targetTable: "tags",
};
const teamMembers = {
	table: "developer_teams",
	ownerColumn: "team_id",
	ownerTable: "teams",
	targetColumn: "developer_id",
	targetTable: "developers",
};
const teamTags = {
	table: "team_tags",
	ownerColumn: "team_id",
	ownerTable: "teams",
	targetColumn: "tag_id",
	targetTable: "tags",
};

const DIRECTORY_CHANGED =
	"The directory changed while you were editing. Close this editor and reload the directory before saving again.";
function writeConflict(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	if (/directory_revisions\.revision/i.test(error.message))
		return DIRECTORY_CHANGED;
	return /constraint|unique/i.test(error.message)
		? "Name or account is already in use; reload the directory"
		: null;
}
function expectedRevision(c: Context<AppEnv>): number | null {
	const header = c.req.header("if-match") ?? "";
	if (!/^"(0|[1-9]\d*)"$/.test(header)) return null;
	const value = Number(header.slice(1, -1));
	return Number.isSafeInteger(value) ? value : null;
}
function assertRevision(db: D1Database, source: DataSource, revision: number) {
	// A zero-row UPDATE would not roll back the rest of a D1 batch. A stale
	// revision deliberately violates NOT NULL, aborting every write atomically.
	return db
		.prepare(`UPDATE directory_revisions
		SET revision = CASE WHEN revision = ? THEN revision ELSE NULL END WHERE source = ?`)
		.bind(revision, source);
}

function resolveMembership(
	draft: MemberDraft | TeamDraft | TagDraft,
	data: DirectoryData,
	id: string,
): { accounts: DirectoryIdentity[] } | { error: string; status: 400 | 409 } {
	const validIds = (
		ids: string[],
		entities: { id: string; archivedAt: number | null }[],
	) =>
		ids.every((value) =>
			entities.some(
				(entity) => entity.id === value && entity.archivedAt === null,
			),
		);
	if (
		("teamIds" in draft && !validIds(draft.teamIds, data.teams)) ||
		("memberIds" in draft && !validIds(draft.memberIds, data.members)) ||
		("tagIds" in draft && !validIds(draft.tagIds, data.tags))
	) {
		return {
			error:
				"Membership targets must be active and belong to the same data source",
			status: 400,
		};
	}
	const accounts: DirectoryIdentity[] = [];
	if ("identityKeys" in draft) {
		for (const key of draft.identityKeys) {
			const identity = data.identities.find((account) => account.key === key);
			if (!identity)
				return {
					error: "Choose an account observed in the collected PRs",
					status: 400,
				};
			if (identity.memberId !== null && identity.memberId !== id)
				return {
					error: "This account is already linked to another member",
					status: 409,
				};
			accounts.push(identity);
		}
	}
	return { accounts };
}

export async function directorySaveRoute(c: Context<AppEnv>) {
	const kind = entityKind(c.req.param("kind"));
	if (!kind) return c.json({ error: "Unknown directory entity" }, 404);
	const source = dataSourceSchema.safeParse(c.req.query("source") ?? "cli");
	if (!source.success) return c.json({ error: "Invalid data source" }, 400);
	if (
		source.data === "demo" &&
		!(
			c.env.SIGNOFF_DEMO_MODE === "1" && isLocalhost(c.req.header("host") ?? "")
		)
	) {
		return c.json(
			{ error: "Sample editing is available in the local demo environment" },
			403,
		);
	}
	const revision = expectedRevision(c);
	if (revision === null)
		return c.json(
			{ error: "Reload the directory before editing; If-Match is required" },
			428,
		);
	const raw = await readJsonBodyWithSize(c, 32_768);
	if (!raw.ok)
		return c.json(
			{ error: raw.error },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const schema = {
		members: memberDraftSchema,
		teams: teamDraftSchema,
		tags: tagDraftSchema,
	}[kind];
	const parsed = schema.safeParse(raw.value);
	if (!parsed.success)
		return c.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid directory entry" },
			400,
		);
	const draft = parsed.data;
	const avatar = normalizeAvatarUrl(
		"avatarUrl" in draft ? draft.avatarUrl : null,
	);
	if ("error" in avatar) return c.json({ error: avatar.error }, 400);
	const avatarValue = "value" in avatar ? avatar.value : null;
	const id = c.req.param("id") ?? newId();
	const editing = c.req.method === "PUT";
	const db = c.env.DB;
	const data = await readDirectory(db, source.data);
	if (data.revision !== revision)
		return c.json({ error: DIRECTORY_CHANGED }, 409);
	if (
		editing &&
		!data[kind].some((entity) => entity.id === id && entity.archivedAt === null)
	) {
		return c.json({ error: "Directory entry not found" }, 404);
	}
	const membership = resolveMembership(draft, data, id);
	if ("error" in membership)
		return c.json({ error: membership.error }, membership.status);
	const { accounts } = membership;
	const table = entityTables[kind];
	const statements: D1PreparedStatement[] = [
		assertRevision(db, source.data, revision),
	];
	if ("color" in draft) {
		statements.push(
			editing
				? db
						.prepare(
							"UPDATE tags SET name = ?, color = ?, updated_at = unixepoch() WHERE id = ? AND source = ? AND archived_at IS NULL",
						)
						.bind(draft.name, draft.color, id, source.data)
				: db
						.prepare(
							"INSERT INTO tags (id, source, name, color) VALUES (?, ?, ?, ?)",
						)
						.bind(id, source.data, draft.name, draft.color),
		);
	} else {
		statements.push(
			editing
				? db
						.prepare(
							`UPDATE ${table} SET name = ?, avatar_url = ?, updated_at = unixepoch() WHERE id = ? AND source = ? AND archived_at IS NULL`,
						)
						.bind(draft.name, avatarValue, id, source.data)
				: kind === "members"
					? db
							.prepare(
								"INSERT INTO developers (id, source, name, alias, avatar_url) VALUES (?, ?, ?, ?, ?)",
							)
							.bind(
								id,
								source.data,
								draft.name,
								`pr-${id.toLowerCase()}`,
								avatarValue,
							)
					: db
							.prepare(
								"INSERT INTO teams (id, source, name, avatar_url) VALUES (?, ?, ?, ?)",
							)
							.bind(id, source.data, draft.name, avatarValue),
		);
	}
	if ("teamIds" in draft) {
		statements.push(
			...replaceLinks(db, source.data, id, draft.teamIds, memberTeams),
		);
		statements.push(
			...replaceLinks(db, source.data, id, draft.tagIds, memberTags),
		);
		const guard =
			"EXISTS (SELECT 1 FROM developers WHERE id = ?1 AND source = ?2 AND archived_at IS NULL)";
		statements.push(
			db
				.prepare(
					`DELETE FROM developer_identities WHERE developer_id = ?1 AND source = ?2 AND ${guard}`,
				)
				.bind(id, source.data),
		);
		statements.push(
			db
				.prepare(`INSERT INTO developer_identities (source, identity_key, provider, organization, actor_id, developer_id, name, handle, avatar_url, last_seen_at)
			SELECT ?2, json_extract(value, '$.key'), json_extract(value, '$.provider'), json_extract(value, '$.organization'), json_extract(value, '$.actorId'), ?1,
			json_extract(value, '$.name'), json_extract(value, '$.handle'), json_extract(value, '$.avatarUrl'), json_extract(value, '$.lastSeenAt')
			FROM json_each(?3) WHERE ${guard}`)
				.bind(id, source.data, JSON.stringify(accounts)),
		);
	} else if ("memberIds" in draft) {
		statements.push(
			...replaceLinks(db, source.data, id, draft.memberIds, teamMembers),
		);
		statements.push(
			...replaceLinks(db, source.data, id, draft.tagIds, teamTags),
		);
	}
	if (source.data === "cli" && table !== "tags") {
		statements.push(
			...staleBumpStatements(db, "directory updated", {
				onlyIfLive: { table, id },
			}),
		);
	}
	try {
		const result = await db.batch(statements);
		if (!batchChanges(result[1]))
			return c.json({ error: "Directory entry not found" }, 404);
	} catch (error) {
		const conflict = writeConflict(error);
		if (conflict) return c.json({ error: conflict }, 409);
		throw error;
	}
	return c.json({ id }, editing ? 200 : 201);
}

export async function directoryArchiveRoute(c: Context<AppEnv>) {
	const kind = entityKind(c.req.param("kind"));
	const action = c.req.param("action");
	if (!kind || (action !== "archive" && action !== "restore"))
		return c.json({ error: "Unknown directory action" }, 404);
	const source = dataSourceSchema.safeParse(c.req.query("source") ?? "cli");
	if (!source.success) return c.json({ error: "Invalid data source" }, 400);
	if (
		source.data === "demo" &&
		!(
			c.env.SIGNOFF_DEMO_MODE === "1" && isLocalhost(c.req.header("host") ?? "")
		)
	) {
		return c.json(
			{ error: "Sample editing is available in the local demo environment" },
			403,
		);
	}
	const revision = expectedRevision(c);
	if (revision === null)
		return c.json(
			{ error: "Reload the directory before editing; If-Match is required" },
			428,
		);
	const table = entityTables[kind];
	const archived = action === "archive";
	try {
		const statements = [
			assertRevision(c.env.DB, source.data, revision),
			c.env.DB.prepare(`UPDATE ${table} SET archived_at = ${archived ? "unixepoch()" : "NULL"}, updated_at = unixepoch()
			WHERE id = ? AND source = ? AND archived_at IS ${archived ? "NULL" : "NOT NULL"}`).bind(
				c.req.param("id") ?? "",
				source.data,
			),
		];
		if (source.data === "cli" && table !== "tags")
			statements.push(
				...staleBumpStatements(c.env.DB, `directory ${action}`, {
					onlyIfPreviousChanges: true,
				}),
			);
		const result = await c.env.DB.batch(statements);
		if (!batchChanges(result[1]))
			return c.json({ error: "Directory entry not found" }, 404);
	} catch (error) {
		const conflict = writeConflict(error);
		if (conflict) return c.json({ error: conflict }, 409);
		throw error;
	}
	return c.json({ ok: true });
}
