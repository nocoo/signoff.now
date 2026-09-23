import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	type ContributionReport,
	type ContributorStatistics,
	contributionFiltersSchema,
	identityKey,
	repositoryKey,
} from "@signoff/domain/insights";
import app from "../index";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite);
});
afterEach(() => sqlite.close());

function request(overrides: Record<string, unknown> = {}) {
	const filters = contributionFiltersSchema.parse({
		source: "cli",
		from: "2026-06-26",
		to: "2026-09-23",
		...overrides,
	});
	return app.request(
		`http://localhost/api/insights/report?filters=${encodeURIComponent(JSON.stringify(filters))}`,
		{ headers: { host: "localhost" } },
		{ DB: sqlite.db },
	);
}

async function report(overrides: Record<string, unknown> = {}) {
	const response = await request(overrides);
	expect(response.status).toBe(200);
	return ((await response.json()) as { report: ContributionReport }).report;
}

function follow(id: string, actorId?: string, organization = "test-org") {
	sqlite.raw
		.query(
			"INSERT INTO developers(id, source, name, alias, created_at, updated_at) VALUES(?, 'cli', ?, ?, 1, 1)",
		)
		.run(id, id, id);
	if (actorId)
		sqlite.raw
			.query(
				"INSERT INTO developer_identities(source, identity_key, provider, organization, actor_id, developer_id, name) VALUES('cli', ?, 'ado', ?, ?, ?, ?)",
			)
			.run(
				identityKey("ado", organization, actorId),
				organization,
				actorId,
				id,
				id,
			);
}

describe("cached contributor and repository reports", () => {
	test("initial GET counts cached PRs without saved calculations, provider calls, or writes", async () => {
		seedPull(sqlite);
		const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Unexpected provider request"),
		);
		const before = sqlite.raw.query("SELECT total_changes() AS count").get();
		try {
			const result = await report();
			expect(result.totals).toMatchObject({
				total: 1,
				open: 1,
				contributors: 1,
				repositories: 1,
			});
			expect(result.members).toHaveLength(1);
			expect(result.repositories).toHaveLength(1);
			expect(result.contributions).toHaveLength(1);
			expect(result.contributions[0]?.selected).toBe(true);
			expect(sqlite.raw.query("SELECT total_changes() AS count").get()).toEqual(
				before,
			);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});

	test("uses indexed cohort and latest-metadata lookups", async () => {
		seedPull(sqlite);
		const prepare = sqlite.db.prepare.bind(sqlite.db);
		let plan = "";
		sqlite.db.prepare = (sql) => {
			const statement = prepare(sql);
			const bind = statement.bind.bind(statement);
			statement.bind = (...values) => {
				if (sql.includes("author_snapshots AS")) {
					plan = JSON.stringify(
						sqlite.raw
							.query(`EXPLAIN QUERY PLAN ${sql}`)
							.all(...(values as never[])),
					);
				}
				return bind(...values);
			};
			return statement;
		};
		await report();
		expect(plan).toContain("pull_requests_created_cohort");
		expect(plan).toContain("pull_requests_author_observation");
		expect(plan).toContain("pull_requests_repository_observation");
	});

	test("combines an exact followed identity across repositories without shrinking repository denominators", async () => {
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "alice-second",
			externalId: "2",
			number: 2,
			repository: { id: "repo-2", name: "service" },
			state: "merged",
		});
		seedPull(sqlite, {
			id: "other-author",
			externalId: "3",
			number: 3,
			author: { id: "actor-other", name: "Alice" },
			state: "closed",
		});
		seedProject(sqlite, { id: "other-org", organization: "other-org" });
		seedPull(sqlite, {
			id: "other-account",
			projectId: "other-org",
			author: { id: "actor-1", name: "Alice" },
		});
		seedProject(sqlite, {
			id: "sample-project",
			source: "demo",
			organization: "sample-org",
		});
		seedPull(sqlite, { id: "sample-pr", projectId: "sample-project" });
		follow("followed-alice", "actor-1", "TEST-ORG");
		follow("no-prs");
		const result = await report({ audience: "followed" });
		expect(result.totals).toMatchObject({
			total: 2,
			contributors: 1,
			repositories: 2,
			open: 1,
			merged: 1,
		});
		expect(result.members).toHaveLength(2);
		expect(result.members[0]).toMatchObject({
			key: "member:followed-alice",
			total: 2,
			name: "followed-alice",
		});
		expect(result.members[1]).toMatchObject({ key: "member:no-prs", total: 0 });
		expect(
			result.repositories.find(
				(repo) => repo.key === repositoryKey("live-project", "repo-1"),
			),
		).toMatchObject({ total: 2, contributors: 2 });
		expect(result.contributions.filter((row) => row.selected)).toHaveLength(2);
		expect(
			result.contributions.find(
				(row) =>
					row.key === `identity:${identityKey("ado", "other-org", "actor-1")}`,
			)?.selected,
		).toBe(false);
		expect(result.contributions).toHaveLength(4);
		expect((await report({ source: "demo" })).totals.total).toBe(1);
		const selected = await report({
			contributorKeys: ["member:followed-alice"],
			repositoryKeys: [repositoryKey("live-project", "repo-1")],
		});
		expect(selected.totals.total).toBe(1);
		expect(selected.repositories[0]?.total).toBe(2);
		expect(selected.contributions).toHaveLength(2);
	});

	test("counts the inclusive 90-day creation cohort in every lifecycle state and partitions drafts", async () => {
		const start = Date.parse("2026-06-26T00:00:00Z") / 1000;
		const end = Date.parse("2026-09-24T00:00:00Z") / 1000;
		const cases = [
			{ createdAt: start, state: "open" as const },
			{ createdAt: end - 1, state: "merged" as const, mergedAt: end + 1 },
			{ createdAt: PR_TEST_NOW, state: "closed" as const },
			{ createdAt: PR_TEST_NOW, state: "open" as const, draft: true },
			{ createdAt: start - 1, state: "merged" as const, mergedAt: PR_TEST_NOW },
			{ createdAt: end, state: "open" as const },
		];
		for (const [index, overrides] of cases.entries())
			seedPull(sqlite, {
				id: `pull-${index}`,
				externalId: String(index),
				number: index,
				...overrides,
			});
		expect((await report()).totals).toMatchObject({
			total: 3,
			open: 1,
			merged: 1,
			closed: 1,
			draft: 0,
		});
		expect((await report({ includeDraft: true })).totals).toMatchObject({
			total: 4,
			open: 1,
			merged: 1,
			closed: 1,
			draft: 1,
		});
		expect((await report({ states: ["merged"] })).totals.total).toBe(1);
		expect((await request({ from: "2026-06-25" })).status).toBe(400);
		expect((await request({ from: null, to: null })).status).toBe(400);
	});

	test("uses latest metadata outside the cohort and keeps exact team and tag intersections", async () => {
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "old",
			externalId: "2",
			number: 2,
			createdAt: PR_TEST_NOW - 150 * 86400,
			observedAt: PR_TEST_NOW + 60,
			author: { id: "actor-1", name: "Current name" },
			repository: { id: "repo-1", name: "Current repo" },
		});
		expect((await report()).members[0]?.name).toBe("Current name");
		expect((await report()).repositories[0]?.name).toBe("Current repo");
		seedProject(sqlite, {
			id: "same-account-project",
			projectKey: "Elsewhere",
		});
		seedPull(sqlite, {
			id: "account-history",
			projectId: "same-account-project",
			createdAt: PR_TEST_NOW - 150 * 86400,
			observedAt: PR_TEST_NOW + 120,
			author: { id: "actor-1", name: "Latest across projects" },
		});
		expect((await report()).members[0]?.name).toBe("Latest across projects");
		follow("person", "actor-1");
		sqlite.raw.exec(
			"INSERT INTO teams(id,source,name,created_at,updated_at) VALUES('team','cli','Team',1,1),('team2','cli','Team 2',1,1); INSERT INTO developer_teams(developer_id,team_id) VALUES('person','team'),('person','team2'); INSERT INTO tags(id,source,name,color,created_at,updated_at) VALUES('tag','cli','Tag','#FFFFFF',1,1); INSERT INTO team_tags(team_id,tag_id) VALUES('team','tag'),('team2','tag');",
		);
		const selected = await report({
			teamIds: ["team", "team2"],
			tagIds: ["tag"],
		});
		expect(selected.totals.total).toBe(1);
		expect(selected.members[0]).toMatchObject({
			name: "person",
			teamIds: ["team", "team2"],
		});
		const excluded = await report({ teamIds: ["missing"] });
		expect(excluded.totals.total).toBe(0);
		expect(excluded.repositories[0]?.total).toBe(1);
		expect(excluded.contributions[0]?.selected).toBe(false);
	});

	test("keeps unknown authors distinct with their own metadata", async () => {
		seedPull(sqlite, { author: { id: "unknown", name: "First unknown" } });
		seedPull(sqlite, {
			id: "unknown-2",
			externalId: "2",
			number: 2,
			observedAt: PR_TEST_NOW + 1,
			author: { id: "unknown", name: "Second unknown" },
		});
		const result = await report();
		expect(result.members).toHaveLength(2);
		expect(
			result.members.find((row) => row.key === "unknown:pull-1")?.name,
		).toBe("First unknown");
		expect(
			result.members.find((row) => row.key === "unknown:unknown-2")?.name,
		).toBe("Second unknown");
	});

	test("excludes blocked contributors from reports and denominators but retains their cached hover statistics", async () => {
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "second",
			externalId: "2",
			number: 2,
			repository: { id: "repo-2", name: "Service" },
			state: "merged",
		});
		seedPull(sqlite, {
			id: "other",
			externalId: "3",
			number: 3,
			author: { id: "other", name: "Other author" },
		});
		follow("person", "actor-1");
		const revision = (
			sqlite.raw
				.query("SELECT revision FROM directory_revisions WHERE source = 'cli'")
				.get() as { revision: number }
		).revision;
		const response = await app.request(
			"http://localhost/api/directory/blocks",
			{
				method: "POST",
				headers: {
					host: "localhost",
					"content-type": "application/json",
					"if-match": `"${revision}"`,
				},
				body: JSON.stringify({ key: "member:person", blocked: true }),
			},
			{ DB: sqlite.db },
		);
		expect(response.status).toBe(200);
		const result = await report();
		expect(result.totals.total).toBe(1);
		expect(result.members.map((row) => row.key)).not.toContain("member:person");
		expect(result.repositories).toHaveLength(1);
		expect(result.repositories[0]).toMatchObject({ total: 1, contributors: 1 });
		expect((await report({ audience: "followed" })).totals.total).toBe(0);
		const clock = spyOn(Date, "now").mockReturnValue(
			Date.parse("2026-09-23T12:00:00Z"),
		);
		try {
			const before = sqlite.raw.query("SELECT total_changes() AS count").get();
			const hover = await app.request(
				"http://localhost/api/insights/contributor?source=cli&key=member%3Aperson",
				{ headers: { host: "localhost" } },
				{ DB: sqlite.db },
			);
			expect(hover.status).toBe(200);
			const { statistics } = (await hover.json()) as {
				statistics: ContributorStatistics;
			};
			expect(statistics).toMatchObject({
				key: "member:person",
				blocked: true,
				from: "2026-06-26",
				to: "2026-09-23",
				totals: { total: 2, repositories: 2 },
			});
			expect(statistics.repositories).toHaveLength(2);
			expect(sqlite.raw.query("SELECT total_changes() AS count").get()).toEqual(
				before,
			);
			const foreign = await app.request(
				"http://localhost/api/insights/contributor?source=demo&key=member%3Aperson",
				{ headers: { host: "localhost" } },
				{ DB: sqlite.db },
			);
			expect(foreign.status).toBe(404);
			sqlite.raw.exec(
				"UPDATE developers SET archived_at = 1 WHERE id = 'person'",
			);
			const archived = await app.request(
				"http://localhost/api/insights/contributor?source=cli&key=member%3Aperson",
				{ headers: { host: "localhost" } },
				{ DB: sqlite.db },
			);
			expect(
				((await archived.json()) as { statistics: ContributorStatistics })
					.statistics,
			).toMatchObject({ blocked: true, totals: { total: 2 } });
			expect((await report()).totals.total).toBe(1);
		} finally {
			clock.mockRestore();
		}
	});

	test("rejects invalid and oversized report filters without reserving calculations", async () => {
		for (const filters of [
			"not-json",
			JSON.stringify({ source: "wrong" }),
			"x".repeat(32769),
		]) {
			const response = await app.request(
				`http://localhost/api/insights/report?filters=${encodeURIComponent(filters)}`,
				{ headers: { host: "localhost" } },
				{ DB: sqlite.db },
			);
			expect(response.status).toBe(400);
		}
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS count FROM pr_stat_snapshots").get(),
		).toEqual({ count: 0 });
	});
});
