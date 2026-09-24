import {
	type ContributionFilters,
	type ContributionModule,
	type ContributionReport,
	type ContributionSnapshot,
	type ContributionTotals,
	type ContributorRepositoryContribution,
	type ContributorStatistics,
	contributionFiltersSchema,
	contributionModuleSchema,
	contributorKeySchema,
	type DailyContribution,
	dataSourceSchema,
	type MemberContribution,
	type PullCounts,
	type RepositoryContribution,
} from "@signoff/domain/insights";
import type { Context } from "hono";
import { normalizeAvatarUrl } from "../lib/entities";
import { readJsonBodyWithSize } from "../lib/http-body";
import { hasLocalTrust } from "../middleware/entry-control";
import type { AppEnv } from "../types";

const COUNTS_SQL = `COUNT(*) AS total,
	COALESCE(SUM(category = 'open'), 0) AS open, COALESCE(SUM(category = 'merged'), 0) AS merged,
	COALESCE(SUM(category = 'closed'), 0) AS closed, COALESCE(SUM(category = 'draft'), 0) AS draft`;

/** EXISTS makes membership an intersection, never a join that multiplies PRs. */
function membershipScope(memberId: string, teams: string, tags: string) {
	return `(${teams} = '[]' OR EXISTS (
		SELECT 1 FROM developer_teams dt JOIN teams t ON t.id = dt.team_id AND t.archived_at IS NULL
		WHERE dt.developer_id = ${memberId} AND dt.team_id IN (SELECT value FROM json_each(${teams}))
	)) AND (${tags} = '[]' OR EXISTS (
		SELECT 1 FROM developer_tags dt JOIN tags tag ON tag.id = dt.tag_id AND tag.archived_at IS NULL
		WHERE dt.developer_id = ${memberId} AND dt.tag_id IN (SELECT value FROM json_each(${tags}))
	) OR EXISTS (
		SELECT 1 FROM developer_teams dt JOIN teams t ON t.id = dt.team_id AND t.archived_at IS NULL
		JOIN team_tags tt ON tt.team_id = t.id JOIN tags tag ON tag.id = tt.tag_id AND tag.archived_at IS NULL
		WHERE dt.developer_id = ${memberId} AND tt.tag_id IN (SELECT value FROM json_each(${tags}))
	))`;
}

function filteredFacts(
	db: D1Database,
	filters: ContributionFilters,
	allContributors = false,
	dateField: "createdAt" | "mergedAt" = "mergedAt",
	includeBlocked = false,
) {
	const sql = `WITH facts AS (
		SELECT pr.id AS factId, pr.state, pr.project_id AS projectId, pr.repository_id AS repositoryId,
		p.provider, p.organization,
		json_array(pr.project_id, pr.repository_id) AS repositoryKey,
		json_extract(pr.snapshot, '$.repository.name') AS repositoryName,
		json_extract(pr.snapshot, '$.author.id') AS authorId,
		CASE WHEN pr.state = 'merged' THEN json_extract(pr.snapshot, '$.mergedAt') END AS mergedAt,
		json_extract(pr.snapshot, '$.createdAt') AS createdAt,
		json_extract(pr.snapshot, '$.observedAt') AS observedAt,
		CASE WHEN json_extract(pr.snapshot, '$.draft') = 1 THEN 'draft' ELSE pr.state END AS category,
		d.id AS memberId, COALESCE(d.name, json_extract(pr.snapshot, '$.author.name')) AS name,
		COALESCE(d.avatar_url, json_extract(pr.snapshot, '$.author.avatarUrl')) AS avatarUrl,
		CASE WHEN d.id IS NOT NULL THEN 'member:' || d.id
			WHEN json_extract(pr.snapshot, '$.author.id') = 'unknown' THEN 'unknown:' || pr.id
			ELSE 'identity:' || json_array(p.provider, lower(p.organization), json_extract(pr.snapshot, '$.author.id')) END AS contributorKey
		FROM pull_requests pr JOIN projects p ON p.id = pr.project_id
		LEFT JOIN developer_identities i ON i.source = p.source AND i.provider = p.provider
			AND i.organization = p.organization COLLATE NOCASE AND i.actor_id = json_extract(pr.snapshot, '$.author.id')
		LEFT JOIN developers d ON d.id = i.developer_id AND d.source = p.source AND d.archived_at IS NULL
		WHERE p.source = ?1
		${dateField === "createdAt" ? "AND json_extract(pr.snapshot, '$.createdAt') >= ?2 AND json_extract(pr.snapshot, '$.createdAt') < ?3" : ""}
		${
			includeBlocked
				? ""
				: `AND NOT EXISTS (SELECT 1 FROM contributor_blocks b WHERE b.source = p.source
			AND (b.contributor_key = 'identity:' || json_array(p.provider, lower(p.organization), json_extract(pr.snapshot, '$.author.id'))
			OR b.contributor_key = 'member:' || i.developer_id))`
		}
	), cohort AS (
		SELECT *, ((?6 = '[]' OR contributorKey IN (SELECT value FROM json_each(?6)))
		AND (?9 = 'all' OR memberId IS NOT NULL)
		AND ${membershipScope("memberId", "?7", "?8")}) AS selected
		FROM facts WHERE (?2 IS NULL OR ${dateField} >= ?2) AND (?3 IS NULL OR ${dateField} < ?3)
		AND (?4 = '[]' OR projectId IN (SELECT value FROM json_each(?4)))
		AND (?5 = '[]' OR repositoryKey IN (SELECT value FROM json_each(?5)))
		AND (?10 = 1 OR category != 'draft')
		AND state IN (SELECT value FROM json_each(?11))
	), filtered AS (
		SELECT * FROM cohort WHERE ${allContributors ? "1" : "selected = 1"}
	)`;
	const values = [
		filters.source,
		filters.from === null
			? null
			: Date.parse(`${filters.from}T00:00:00Z`) / 1000,
		filters.to === null
			? null
			: Date.parse(`${filters.to}T00:00:00Z`) / 1000 + 86400,
		JSON.stringify(filters.projectIds),
		JSON.stringify(filters.repositoryKeys),
		JSON.stringify(filters.contributorKeys),
		JSON.stringify(filters.teamIds),
		JSON.stringify(filters.tagIds),
		filters.audience,
		Number(filters.includeDraft),
		JSON.stringify(filters.states),
	];
	return (query: string) => db.prepare(`${sql} ${query}`).bind(...values);
}

const EMPTY_COUNTS = { total: 0, open: 0, merged: 0, closed: 0, draft: 0 };
const TEAM_IDS_SQL = `(SELECT json_group_array(dt.team_id) FROM developer_teams dt
	JOIN teams t ON t.id = dt.team_id AND t.archived_at IS NULL WHERE dt.developer_id = memberId) AS team_ids`;
type MemberRow = Omit<MemberContribution, "teamIds"> & { team_ids: string };
function mapMember(row: MemberRow): MemberContribution {
	const avatar = normalizeAvatarUrl(row.avatarUrl);
	const { team_ids, ...rest } = row;
	return {
		...rest,
		teamIds: (JSON.parse(team_ids) as string[]).sort(),
		avatarUrl: "value" in avatar ? avatar.value : null,
	};
}

function followedMembers(db: D1Database, filters: ContributionFilters) {
	return db
		.prepare(`WITH members AS (
		SELECT id AS memberId, 'member:' || id AS key, name, avatar_url AS avatarUrl FROM developers
		WHERE source = ?1 AND archived_at IS NULL
		AND NOT EXISTS (SELECT 1 FROM contributor_blocks b WHERE b.source = ?1 AND b.contributor_key = 'member:' || developers.id)
	) SELECT *, ${TEAM_IDS_SQL} FROM members
	WHERE (?2 = '[]' OR key IN (SELECT value FROM json_each(?2))) AND ${membershipScope("memberId", "?3", "?4")}`)
		.bind(
			filters.source,
			JSON.stringify(filters.contributorKeys),
			JSON.stringify(filters.teamIds),
			JSON.stringify(filters.tagIds),
		);
}

async function calculate(
	db: D1Database,
	module: ContributionModule,
	filters: ContributionFilters,
	dateField: "createdAt" | "mergedAt" = "mergedAt",
	includeBlocked = false,
): Promise<ContributionSnapshot> {
	const query = filteredFacts(db, filters, false, dateField, includeBlocked);
	const statements = [
		query(`SELECT ${COUNTS_SQL}, COUNT(DISTINCT contributorKey) AS contributors,
		COUNT(DISTINCT repositoryKey) AS repositories, MAX(observedAt) AS lastCollectedAt FROM filtered`),
	];
	if (module === "trend")
		statements.push(
			query(`SELECT strftime('%Y-%m-%d', mergedAt, 'unixepoch') AS day, ${COUNTS_SQL}
		FROM filtered GROUP BY day ORDER BY day`),
		);
	if (module === "repositories")
		statements.push(
			query(`, metadata AS (
			SELECT repositoryKey, repositoryName,
			ROW_NUMBER() OVER (PARTITION BY repositoryKey ORDER BY observedAt DESC, factId) AS rank FROM facts
		) SELECT f.repositoryKey AS key, projectId, repositoryId AS id,
		metadata.repositoryName AS name, ${COUNTS_SQL}, COUNT(DISTINCT contributorKey) AS contributors, MAX(observedAt) AS lastCollectedAt
		FROM filtered f JOIN metadata ON metadata.repositoryKey = f.repositoryKey AND metadata.rank = 1
		GROUP BY projectId, repositoryId ORDER BY total DESC, name, key`),
		);
	if (module === "members") {
		statements.push(
			query(`, metadata AS (
				SELECT contributorKey, name, avatarUrl,
				ROW_NUMBER() OVER (PARTITION BY contributorKey ORDER BY observedAt DESC, factId) AS rank FROM facts
			) SELECT f.contributorKey AS key, memberId, metadata.name, metadata.avatarUrl,
			${TEAM_IDS_SQL}, ${COUNTS_SQL}, MAX(observedAt) AS lastCollectedAt
			FROM filtered f JOIN metadata ON metadata.contributorKey = f.contributorKey AND metadata.rank = 1
			GROUP BY f.contributorKey ORDER BY total DESC, metadata.name, key`),
		);
		statements.push(followedMembers(db, filters));
	}
	// D1 batch provides one consistent read of PRs and memberships for this module.
	const result = await db.batch(statements);
	const totals = result[0]?.results[0] as ContributionTotals;
	const snapshot: ContributionSnapshot = {
		module,
		filters,
		calculatedAt: Math.floor(Date.now() / 1000),
		coverage: filters.source === "cli" ? "observed" : "sample",
		totals,
		trend: [],
		members: [],
		repositories: [],
	};
	if (module === "trend" && filters.from !== null && filters.to !== null) {
		const byDay = new Map(
			(result[1]?.results as DailyContribution[]).map((row) => [row.day, row]),
		);
		for (
			let time = Date.parse(filters.from);
			time <= Date.parse(filters.to);
			time += 86_400_000
		) {
			const day = new Date(time).toISOString().slice(0, 10);
			snapshot.trend.push(byDay.get(day) ?? { day, ...EMPTY_COUNTS });
		}
	} else if (module === "repositories") {
		snapshot.repositories = result[1]?.results as RepositoryContribution[];
	} else if (module === "members") {
		const members = new Map(
			(result[1]?.results as MemberRow[]).map((row) => [
				row.key,
				mapMember(row),
			]),
		);
		for (const row of result[2]?.results as MemberRow[]) {
			if (!members.has(row.key))
				members.set(
					row.key,
					mapMember({ ...row, ...EMPTY_COUNTS, lastCollectedAt: null }),
				);
		}
		snapshot.members = [...members.values()].sort(
			(a, b) =>
				b.total - a.total ||
				b.merged - a.merged ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key),
		);
	}
	return snapshot;
}

export async function insightsRoute(c: Context<AppEnv>) {
	const requestedAt = Date.now();
	const module = contributionModuleSchema.safeParse(c.req.param("module"));
	if (!module.success)
		return c.json({ error: "Invalid statistics module" }, 400);
	const refresh = c.req.method === "POST";
	let raw: unknown;
	if (refresh) {
		const body = await readJsonBodyWithSize(c, 32_768);
		if (!body.ok)
			return c.json(
				{ error: body.error },
				body.error === "payload_too_large" ? 413 : 400,
			);
		raw = body.value;
	} else {
		const encoded = c.req.query("filters") ?? "";
		if (encoded.length > 32_768)
			return c.json({ error: "Filters are too large" }, 400);
		try {
			raw = JSON.parse(encoded);
		} catch {
			return c.json({ error: "Invalid statistics filters" }, 400);
		}
	}
	const parsed = contributionFiltersSchema.safeParse(raw);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid statistics filters",
			},
			400,
		);
	const filters = parsed.data;
	if (
		refresh &&
		filters.source === "demo" &&
		!(c.env.SIGNOFF_DEMO_MODE === "1" && hasLocalTrust(c))
	)
		return c.json(
			{
				error:
					"Sample calculations are available in the local demo environment",
			},
			403,
		);
	if (module.data === "trend" && filters.from === null)
		return c.json({ error: "Choose dates for the contribution trend" }, 400);
	const key = `merged-v1:${JSON.stringify(filters)}`;
	const read = c.env.DB.prepare(
		"SELECT snapshot FROM pr_stat_snapshots WHERE source = ? AND module = ? AND filter_key = ?",
	).bind(filters.source, module.data, key);
	c.header("Cache-Control", "no-store");
	if (!refresh) {
		return c.json({
			snapshot: await calculate(c.env.DB, module.data, filters),
		});
	}
	// Reserve an increasing generation without changing the last good snapshot.
	// Timestamp ties and clock skew cannot give two refreshes the same generation.
	const reservation = await c.env.DB.batch([
		c.env.DB.prepare(`INSERT INTO pr_stat_snapshots (source, module, filter_key, requested_at, snapshot) VALUES (?, ?, ?, ?, 'null')
			ON CONFLICT (source, module, filter_key) DO UPDATE SET requested_at = MAX(pr_stat_snapshots.requested_at + 1, excluded.requested_at)`).bind(
			filters.source,
			module.data,
			key,
			requestedAt,
		),
		c.env.DB.prepare(
			"SELECT requested_at FROM pr_stat_snapshots WHERE source = ? AND module = ? AND filter_key = ?",
		).bind(filters.source, module.data, key),
	]);
	const generation = (reservation[1]?.results[0] as { requested_at: number })
		.requested_at;
	const snapshot = await calculate(c.env.DB, module.data, filters);
	const saved = await c.env.DB.batch([
		c.env.DB.prepare(
			"UPDATE pr_stat_snapshots SET snapshot = ? WHERE source = ? AND module = ? AND filter_key = ? AND requested_at = ?",
		).bind(
			JSON.stringify(snapshot),
			filters.source,
			module.data,
			key,
			generation,
		),
		read,
	]);
	const row = saved[1]?.results[0] as { snapshot: string };
	const published = JSON.parse(row.snapshot) as ContributionSnapshot | null;
	if (published === null)
		return c.json(
			{
				error:
					"A newer calculation is in progress. Reload this module after it finishes.",
			},
			409,
		);
	return c.json({ snapshot: published });
}

type ContributionRow = MemberRow & {
	repositoryKey: string;
	projectId: string;
	repositoryId: string;
	repositoryName: string;
	selected: number;
};

function addCounts(target: PullCounts, source: PullCounts) {
	for (const key of ["total", "open", "merged", "closed", "draft"] as const)
		target[key] += source[key];
}

function latestObserved(left: number | null, right: number | null) {
	return left === null ? right : right === null ? left : Math.max(left, right);
}

async function calculateReport(
	db: D1Database,
	filters: ContributionFilters,
): Promise<ContributionReport> {
	const query = filteredFacts(db, filters, true, "createdAt");
	const result = await db.batch([
		query(`, accounts AS (
			SELECT DISTINCT f.contributorKey, p.id AS projectId, i.actor_id AS authorId, NULL AS pullId
			FROM facts f JOIN developer_identities i ON i.developer_id = f.memberId AND i.source = ?1
			JOIN projects p ON p.source = i.source AND p.provider = i.provider AND p.organization = i.organization COLLATE NOCASE
			UNION
			SELECT DISTINCT f.contributorKey, p.id AS projectId, f.authorId, CASE WHEN f.authorId = 'unknown' THEN f.factId END AS pullId
			FROM facts f JOIN projects p ON p.source = ?1 AND p.provider = f.provider AND p.organization = f.organization COLLATE NOCASE
			WHERE f.memberId IS NULL AND (f.authorId != 'unknown' OR p.id = f.projectId)
		), author_snapshots AS (
			SELECT contributorKey, (SELECT pr.snapshot FROM pull_requests pr
				WHERE pr.project_id = a.projectId AND json_extract(pr.snapshot, '$.author.id') = a.authorId
				AND (a.pullId IS NULL OR pr.id = a.pullId)
				ORDER BY json_extract(pr.snapshot, '$.observedAt') DESC, pr.id LIMIT 1) AS snapshot
			FROM accounts a
		), authors AS (
			SELECT contributorKey, snapshot,
			ROW_NUMBER() OVER (PARTITION BY contributorKey ORDER BY json_extract(snapshot, '$.observedAt') DESC, json_extract(snapshot, '$.id')) AS rank
			FROM author_snapshots
		), repositories AS (
			SELECT DISTINCT projectId, repositoryId, repositoryKey FROM facts
		), repository_metadata AS (
			SELECT repositoryKey, (SELECT json_extract(pr.snapshot, '$.repository.name') FROM pull_requests pr
				WHERE pr.project_id = r.projectId AND pr.repository_id = r.repositoryId
				ORDER BY json_extract(pr.snapshot, '$.observedAt') DESC, pr.id LIMIT 1) AS repositoryName
			FROM repositories r
		) SELECT f.contributorKey AS key, memberId,
		COALESCE(d.name, json_extract(authors.snapshot, '$.author.name')) AS name,
		COALESCE(d.avatar_url, json_extract(authors.snapshot, '$.author.avatarUrl')) AS avatarUrl,
		${TEAM_IDS_SQL}, ${COUNTS_SQL}, MAX(observedAt) AS lastCollectedAt,
		f.repositoryKey, projectId, repositoryId, repository_metadata.repositoryName, selected
		FROM filtered f
		JOIN authors ON authors.contributorKey = f.contributorKey AND authors.rank = 1
		JOIN repository_metadata ON repository_metadata.repositoryKey = f.repositoryKey
		LEFT JOIN developers d ON d.id = f.memberId AND d.source = ?1 AND d.archived_at IS NULL
		GROUP BY f.repositoryKey, f.contributorKey ORDER BY total DESC, name, key, f.repositoryKey`),
		followedMembers(db, filters),
	]);
	const members = new Map<string, MemberContribution>();
	const repositories = new Map<string, RepositoryContribution>();
	const contributions: ContributorRepositoryContribution[] = [];
	const selectedRepositories = new Set<string>();
	const selectedMembers = new Set<string>();
	const totals: ContributionTotals = {
		...EMPTY_COUNTS,
		contributors: 0,
		repositories: 0,
		lastCollectedAt: null,
	};
	for (const row of result[0]?.results as ContributionRow[]) {
		const {
			repositoryKey,
			projectId,
			repositoryId,
			repositoryName,
			selected,
			...memberRow
		} = row;
		const contribution = {
			...mapMember(memberRow),
			repositoryKey,
			selected: selected === 1,
		};
		contributions.push(contribution);
		let repository = repositories.get(repositoryKey);
		if (!repository) {
			repository = {
				key: repositoryKey,
				projectId,
				id: repositoryId,
				name: repositoryName,
				...EMPTY_COUNTS,
				contributors: 0,
				lastCollectedAt: null,
			};
			repositories.set(repositoryKey, repository);
		}
		addCounts(repository, contribution);
		repository.contributors++;
		repository.lastCollectedAt = latestObserved(
			repository.lastCollectedAt,
			contribution.lastCollectedAt,
		);
		if (!contribution.selected) continue;
		selectedRepositories.add(repositoryKey);
		selectedMembers.add(contribution.key);
		addCounts(totals, contribution);
		totals.lastCollectedAt = latestObserved(
			totals.lastCollectedAt,
			contribution.lastCollectedAt,
		);
		let member = members.get(contribution.key);
		if (!member) {
			member = { ...mapMember(memberRow), ...EMPTY_COUNTS };
			members.set(member.key, member);
		}
		addCounts(member, contribution);
		member.lastCollectedAt = latestObserved(
			member.lastCollectedAt,
			contribution.lastCollectedAt,
		);
	}
	for (const row of result[1]?.results as MemberRow[]) {
		if (!members.has(row.key))
			members.set(
				row.key,
				mapMember({ ...row, ...EMPTY_COUNTS, lastCollectedAt: null }),
			);
	}
	totals.contributors = selectedMembers.size;
	totals.repositories = selectedRepositories.size;
	return {
		filters,
		calculatedAt: Math.floor(Date.now() / 1000),
		coverage: filters.source === "cli" ? "observed" : "sample",
		totals,
		members: [...members.values()].sort(
			(a, b) =>
				b.total - a.total ||
				b.merged - a.merged ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key),
		),
		repositories: [...repositories.values()].sort(
			(a, b) =>
				b.total - a.total ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key),
		),
		contributions,
	};
}

export async function insightsReportRoute(c: Context<AppEnv>) {
	const encoded = c.req.query("filters") ?? "";
	if (encoded.length > 32_768)
		return c.json({ error: "Filters are too large" }, 400);
	let raw: unknown;
	try {
		raw = JSON.parse(encoded);
	} catch {
		return c.json({ error: "Invalid statistics filters" }, 400);
	}
	const parsed = contributionFiltersSchema.safeParse(raw);
	if (!parsed.success)
		return c.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid statistics filters",
			},
			400,
		);
	const filters = parsed.data;
	if (
		filters.from === null ||
		filters.to === null ||
		Date.parse(filters.to) - Date.parse(filters.from) >= 90 * 86_400_000
	)
		return c.json({ error: "Choose a period of at most 90 days" }, 400);
	c.header("Cache-Control", "no-store");
	return c.json({ report: await calculateReport(c.env.DB, filters) });
}

export async function contributorStatisticsRoute(c: Context<AppEnv>) {
	const source = dataSourceSchema.safeParse(c.req.query("source") ?? "cli");
	const key = contributorKeySchema.safeParse(c.req.query("key"));
	if (!source.success || !key.success)
		return c.json({ error: "Invalid contributor identity" }, 400);
	const db = c.env.DB;
	const member = key.data.startsWith("member:")
		? await db
				.prepare(
					"SELECT id, archived_at FROM developers WHERE source = ? AND id = ?",
				)
				.bind(source.data, key.data.slice(7))
				.first<{ id: string; archived_at: number | null }>()
		: await db
				.prepare(
					"SELECT d.id, d.archived_at FROM developer_identities i JOIN developers d ON d.id = i.developer_id AND d.source = i.source WHERE i.source = ? AND i.identity_key = ?",
				)
				.bind(source.data, key.data.slice(9))
				.first<{ id: string; archived_at: number | null }>();
	let contributorKeys = [key.data];
	if (member) {
		if (member.archived_at === null) contributorKeys = [`member:${member.id}`];
		else {
			const identities = await db
				.prepare(
					"SELECT identity_key FROM developer_identities WHERE source = ? AND developer_id = ?",
				)
				.bind(source.data, member.id)
				.all<{ identity_key: string }>();
			contributorKeys = identities.results.map(
				(row) => `identity:${row.identity_key}`,
			);
			if (contributorKeys.length === 0) contributorKeys = [key.data];
		}
	} else if (key.data.startsWith("member:"))
		return c.json({ error: "Contributor not found in this data source" }, 404);
	const to = new Date(Date.now()).toISOString().slice(0, 10);
	const from = new Date(Date.parse(to) - 89 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const filters = contributionFiltersSchema.parse({
		source: source.data,
		from,
		to,
		contributorKeys,
		includeDraft: true,
	});
	const [snapshot, block] = await Promise.all([
		calculate(db, "repositories", filters, "createdAt", true),
		db
			.prepare(
				"SELECT 1 FROM contributor_blocks WHERE source = ? AND contributor_key IN (SELECT value FROM json_each(?)) LIMIT 1",
			)
			.bind(source.data, JSON.stringify([key.data, ...contributorKeys]))
			.first(),
	]);
	const statistics: ContributorStatistics = {
		source: source.data,
		key: key.data,
		blocked: block !== null,
		followed: member?.archived_at === null,
		from,
		to,
		totals: snapshot.totals,
		repositories: snapshot.repositories,
	};
	c.header("Cache-Control", "no-store");
	return c.json({ statistics });
}
