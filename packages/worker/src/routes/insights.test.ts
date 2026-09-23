import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	type ContributionSnapshot,
	contributionFiltersSchema,
	identityKey,
	repositoryKey,
} from "@signoff/domain/insights";
import app from "../index";
import { setAccessJwtVerifierForTests } from "../middleware/access-auth";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite);
});
afterEach(() => sqlite.close());
const filters = (overrides: Record<string, unknown> = {}) =>
	contributionFiltersSchema.parse({
		source: "cli",
		from: null,
		to: null,
		...overrides,
	});
const request = (
	module: string,
	refresh = false,
	overrides: Record<string, unknown> = {},
) => {
	const scope = filters(overrides);
	return app.request(
		`http://localhost/api/insights/${module}${refresh ? "" : `?filters=${encodeURIComponent(JSON.stringify(scope))}`}`,
		{
			method: refresh ? "POST" : "GET",
			headers: { host: "localhost", "content-type": "application/json" },
			...(refresh ? { body: JSON.stringify(scope) } : {}),
		},
		{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" },
	);
};
async function snapshot(
	module: string,
	refresh = true,
	overrides: Record<string, unknown> = {},
) {
	const response = await request(module, refresh, overrides);
	expect(response.status).toBe(200);
	return ((await response.json()) as { snapshot: ContributionSnapshot })
		.snapshot;
}
async function create(kind: string, body: unknown, source = "cli") {
	const { revision } = sqlite.raw
		.query("SELECT revision FROM directory_revisions WHERE source = ?")
		.get(source) as { revision: number };
	const response = await app.request(
		`http://localhost/api/directory/${kind}?source=${source}`,
		{
			method: "POST",
			headers: {
				host: "localhost",
				"content-type": "application/json",
				"if-match": `"${revision}"`,
			},
			body: JSON.stringify(body),
		},
		{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" },
	);
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string };
}

describe("independent, manually calculated PR statistics", () => {
	test("Sample writes require both a local host and demo mode; saved Sample reads stay read-only", async () => {
		setAccessJwtVerifierForTests(async () => ({
			email: "test@example.com",
			name: "Tester",
			service: false,
		}));
		try {
			for (const [host, mode] of [
				["localhost", "0"],
				["signoff.hexly.ai", "0"],
				["signoff.hexly.ai", "1"],
			]) {
				const response = await app.request(
					`http://${host}/api/insights/overview`,
					{
						method: "POST",
						headers: {
							host: host ?? "",
							"content-type": "application/json",
							"cf-access-jwt-assertion": "test",
						},
						body: JSON.stringify(filters({ source: "demo" })),
					},
					{
						DB: sqlite.db,
						SIGNOFF_DEMO_MODE: mode,
						CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
						CF_ACCESS_AUD: "test",
					},
				);
				expect(response.status).toBe(403);
				expect(
					sqlite.raw
						.query(
							"SELECT COUNT(*) AS count FROM pr_stat_snapshots WHERE source = 'demo'",
						)
						.get(),
				).toEqual({ count: 0 });
			}
			const saved = await snapshot("overview", true, { source: "demo" });
			const response = await app.request(
				`http://localhost/api/insights/overview?filters=${encodeURIComponent(JSON.stringify(filters({ source: "demo" })))}`,
				{
					headers: { host: "localhost" },
				},
				{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "0" },
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				snapshot: { ...saved, calculatedAt: expect.any(Number) },
			});
		} finally {
			setAccessJwtVerifierForTests(null);
		}
	});

	test("statistics use the latest observed repository and author metadata, preserving member profile overrides", async () => {
		async function requestPeriod(moduleId: string) {
			const response = await request(moduleId, true, {
				from: "2026-09-01",
				to: "2026-09-17",
			});
			return ((await response.json()) as { snapshot: ContributionSnapshot })
				.snapshot;
		}
		seedPull(sqlite, {
			state: "merged",
			mergedAt: PR_TEST_NOW,
			repository: { id: "repo-1", name: "z-old-repository" },
			author: {
				id: "actor-1",
				name: "Zulu old name",
				avatarUrl: "https://example.com/z-old.png",
			},
		});
		seedPull(sqlite, {
			state: "merged",
			mergedAt: PR_TEST_NOW,
			id: "pull-2",
			externalId: "2",
			number: 2,
			observedAt: PR_TEST_NOW + 60,
			repository: { id: "repo-1", name: "b-new-repository" },
			author: {
				id: "actor-1",
				name: "Bob new name",
				avatarUrl: "https://example.com/b-new.png",
			},
		});
		expect(
			(await requestPeriod("repositories"))?.repositories[0],
		).toMatchObject({
			name: "b-new-repository",
			total: 2,
			lastCollectedAt: PR_TEST_NOW + 60,
		});
		expect((await requestPeriod("members"))?.members[0]).toMatchObject({
			name: "Bob new name",
			avatarUrl: "https://example.com/b-new.png",
			total: 2,
		});

		// Current labels do not become historical labels when the date filter excludes the latest observed PR.
		seedPull(sqlite, {
			state: "merged",
			id: "pull-3",
			externalId: "3",
			number: 3,
			createdAt: PR_TEST_NOW - 90 * 86400,
			mergedAt: PR_TEST_NOW - 90 * 86400,
			observedAt: PR_TEST_NOW + 120,
			repository: { id: "repo-1", name: "a-current-repository" },
			author: { id: "actor-1", name: "Alice current name" },
		});
		expect(
			(await requestPeriod("repositories"))?.repositories[0],
		).toMatchObject({
			name: "a-current-repository",
			total: 2,
		});
		expect((await requestPeriod("members"))?.members[0]).toMatchObject({
			name: "Alice current name",
			avatarUrl: null,
			total: 2,
		});
		await create("members", {
			name: "Preferred profile",
			avatarUrl: "https://example.com/preferred.png",
			identityKeys: [identityKey("ado", "test-org", "actor-1")],
		});
		expect((await requestPeriod("members"))?.members[0]).toMatchObject({
			name: "Preferred profile",
			avatarUrl: "https://example.com/preferred.png",
			total: 2,
		});
	});

	test("malformed and oversized inputs cannot reserve or change a calculation", async () => {
		for (const body of [
			"{",
			"null",
			JSON.stringify({ source: "wrong" }),
			JSON.stringify({ source: "cli", includeDraft: "false" }),
			JSON.stringify({ source: "cli", extra: "x".repeat(33000) }),
		]) {
			const response = await app.request(
				"http://localhost/api/insights/overview",
				{
					method: "POST",
					headers: { host: "localhost", "content-type": "application/json" },
					body,
				},
				{ DB: sqlite.db },
			);
			expect(response.status).toBe(body.length > 32768 ? 413 : 400);
		}
		const response = await app.request(
			`http://localhost/api/insights/overview?filters=${"a".repeat(32769)}`,
			{
				headers: { host: "localhost" },
			},
			{ DB: sqlite.db },
		);
		expect(response.status).toBe(400);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS count FROM pr_stat_snapshots").get(),
		).toEqual({ count: 0 });
	});

	test("a superseded first calculation cannot publish while a newer generation is pending", async () => {
		seedPull(sqlite);
		const batch = sqlite.db.batch.bind(sqlite.db);
		const releases: Array<() => void> = [];
		const started: Array<() => void> = [];
		const waiting = [0, 1].map(
			() => new Promise<void>((resolve) => started.push(resolve)),
		);
		sqlite.db.batch = async <T>(statements: D1PreparedStatement[]) => {
			const result = await batch<T>(statements);
			if (
				releases.length < 2 &&
				(statements[0] as unknown as { sql: string }).sql.includes("WITH facts")
			) {
				const index = releases.length;
				const pause = new Promise<void>((resolve) => releases.push(resolve));
				started[index]?.();
				await pause;
			}
			return result;
		};
		try {
			const older = request("overview", true);
			await waiting[0];
			seedPull(sqlite, { id: "new-pull", number: 2, externalId: "2" });
			const newer = request("overview", true);
			await waiting[1];
			releases[0]?.();
			expect((await older).status).toBe(409);
			releases[1]?.();
			expect((await newer).status).toBe(200);
			expect((await snapshot("overview", false))?.totals.total).toBe(2);
		} finally {
			for (const release of releases) release();
			sqlite.db.batch = batch;
		}
	});
	test("same-millisecond refreshes cannot let an older calculation overwrite a newer result", async () => {
		seedPull(sqlite);
		const clock = spyOn(Date, "now").mockReturnValue(PR_TEST_NOW * 1000);
		let readStarted!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			readStarted = resolve;
		});
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const batch = sqlite.db.batch.bind(sqlite.db);
		let first = true;
		sqlite.db.batch = async <T>(statements: D1PreparedStatement[]) => {
			const result = await batch<T>(statements);
			if (
				first &&
				(statements[0] as unknown as { sql: string }).sql.includes("WITH facts")
			) {
				first = false;
				readStarted();
				await paused;
			}
			return result;
		};
		try {
			const older = request("overview", true);
			await started;
			seedPull(sqlite, { id: "new-pull", number: 2, externalId: "2" });
			expect((await snapshot("overview"))?.totals.total).toBe(2);
			release();
			expect((await older).status).toBe(200);
			expect((await snapshot("overview", false))?.totals.total).toBe(2);
		} finally {
			release();
			clock.mockRestore();
			sqlite.db.batch = batch;
		}
	});
	test("GET calculates immediately from cached facts and does not save snapshots", async () => {
		seedPull(sqlite);
		expect((await snapshot("overview", false))?.totals.total).toBe(1);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS count FROM pr_stat_snapshots").get(),
		).toEqual({ count: 0 });
		const first = await snapshot("overview");
		expect(first?.totals).toMatchObject({
			total: 1,
			open: 1,
			merged: 0,
			draft: 0,
			contributors: 1,
			repositories: 1,
			lastCollectedAt: PR_TEST_NOW,
		});
		expect(first?.coverage).toBe("observed");
		seedPull(sqlite, {
			id: "merged",
			number: 2,
			externalId: "2",
			state: "merged",
			observedAt: PR_TEST_NOW + 60,
		});
		expect((await snapshot("overview", false))?.totals.total).toBe(2);
		expect((await snapshot("members"))?.totals.total).toBe(2);
		expect((await snapshot("overview", false))?.totals.total).toBe(2);
		expect((await snapshot("overview"))?.totals).toMatchObject({
			total: 2,
			open: 1,
			merged: 1,
			lastCollectedAt: PR_TEST_NOW + 60,
		});
		expect(
			(await snapshot("overview", false, { includeDraft: true }))?.totals.total,
		).toBe(2);
	});

	test("inclusive UTC merge dates ignore creation and update time, exclude unmerged and missing dates", async () => {
		const period = { from: "2026-09-01", to: "2026-09-17" };
		const add = (
			id: number,
			merged: string | null,
			state: "open" | "merged" | "closed" = "merged",
			draft = false,
		) =>
			seedPull(sqlite, {
				id: `pr-${id}`,
				number: id,
				externalId: String(id),
				createdAt: Date.parse("2026-08-01T00:00:00Z") / 1000,
				updatedAt: PR_TEST_NOW + 100000,
				mergedAt: merged === null ? null : Date.parse(merged) / 1000,
				state,
				draft,
			});
		add(1, "2026-09-01T00:00:00Z");
		add(2, "2026-09-17T23:59:59Z");
		add(3, null, "closed");
		add(4, null, "open", true);
		add(5, "2026-08-31T23:59:59Z");
		add(6, "2026-09-18T00:00:00Z");
		add(7, null);
		add(8, "2026-09-10T00:00:00Z", "merged", true);
		add(9, "2026-09-12T00:00:00Z", "open");
		expect((await snapshot("overview", true, period))?.totals).toMatchObject({
			total: 2,
			open: 0,
			merged: 2,
			closed: 0,
			draft: 0,
		});
		expect(
			(await snapshot("overview", true, { ...period, includeDraft: true }))
				?.totals,
		).toMatchObject({ total: 3, merged: 2, draft: 1 });
		const trend = await snapshot("trend", true, period);
		expect(trend?.trend).toHaveLength(17);
		expect(trend?.trend[0]).toMatchObject({
			day: "2026-09-01",
			total: 1,
			merged: 1,
		});
		expect(trend?.trend[1]?.total).toBe(0);
		expect(trend?.trend.at(-1)).toMatchObject({ day: "2026-09-17", merged: 1 });
	});
	test("saved calculations never hide the current cached facts", async () => {
		sqlite.raw
			.query(
				"INSERT INTO pr_stat_snapshots(source,module,filter_key,requested_at,snapshot) VALUES('cli','overview',?,1,?)",
			)
			.run(
				JSON.stringify(filters()),
				JSON.stringify({ totals: { total: 99 } }),
			);
		expect((await snapshot("overview", false))?.totals.total).toBe(0);
	});

	test("exact accounts combine across orgs, same names stay separate, and team/repo/tag filters intersect without multiplying PRs", async () => {
		seedProject(sqlite, { id: "project-two", organization: "org-two" });
		seedProject(sqlite, {
			id: "demo-project",
			source: "demo",
			organization: "sample-org",
		});
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "pr-2",
			projectId: "project-two",
			author: { id: "actor-2", name: "Alice" },
			state: "merged",
		});
		seedPull(sqlite, {
			id: "pr-3",
			number: 3,
			externalId: "3",
			author: { id: "someone-else", name: "Alice" },
			state: "closed",
		});
		seedPull(sqlite, {
			id: "demo",
			projectId: "demo-project",
			author: { id: "actor-1", name: "Alice" },
		});
		const team1 = await create("teams", { name: "Platform" });
		const team2 = await create("teams", { name: "On-call" });
		const tag = await create("tags", { name: "Core", color: "#334455" });
		const person = await create("members", {
			name: "Followed Alice",
			teamIds: [team1.id, team2.id],
			tagIds: [tag.id],
			identityKeys: [
				identityKey("ado", "test-org", "actor-1"),
				identityKey("ado", "org-two", "actor-2"),
			],
		});
		const emptyPerson = await create("members", {
			name: "No PRs yet",
			teamIds: [team1.id],
		});
		const result = await snapshot("members", true, {
			teamIds: [team2.id, team1.id],
		});
		expect(result?.totals).toMatchObject({
			total: 2,
			contributors: 1,
			repositories: 2,
		});
		expect(
			result?.members.find((member) => member.memberId === person.id),
		).toMatchObject({
			name: "Followed Alice",
			open: 1,
			merged: 1,
			total: 2,
			teamIds: [team1.id, team2.id].sort(),
		});
		expect(
			result?.members.find((member) => member.memberId === emptyPerson.id)
				?.total,
		).toBe(0);
		expect(
			(
				await snapshot("overview", true, {
					tagIds: [tag.id],
					repositoryKeys: [repositoryKey("live-project", "repo-1")],
				})
			)?.totals.total,
		).toBe(1);
		expect(
			(await snapshot("overview", true, { audience: "followed" }))?.totals
				.total,
		).toBe(2);
		expect((await snapshot("overview"))?.totals.contributors).toBe(2);
		expect(
			(
				await snapshot("overview", true, {
					contributorKeys: [
						`identity:${identityKey("ado", "test-org", "someone-else")}`,
					],
				})
			)?.totals.total,
		).toBe(1);
		expect(
			(await snapshot("overview", true, { source: "demo" }))?.coverage,
		).toBe("sample");
		expect(
			(await snapshot("overview", true, { source: "demo" }))?.totals.total,
		).toBe(1);
		expect(
			(
				await snapshot("overview", true, {
					source: "demo",
					teamIds: [team1.id],
				})
			)?.totals.total,
		).toBe(0);
		expect(
			await snapshot("members", false, { teamIds: [team1.id, team2.id] }),
		).toEqual({ ...result, calculatedAt: expect.any(Number) });
	});

	test("aggregates every stored PR rather than the 1,000-row workbench display cap", async () => {
		for (let id = 1; id <= 1007; id++)
			seedPull(sqlite, {
				id: `pr-${id}`,
				number: id,
				externalId: String(id),
				state: id % 2 === 0 ? "merged" : "open",
			});
		const result = await snapshot("repositories", true, {
			from: null,
			to: null,
		});
		expect(result?.totals.total).toBe(1007);
		expect(result?.repositories).toHaveLength(1);
		expect(result?.repositories[0]).toMatchObject({
			id: "repo-1",
			name: "web-app",
			projectId: "live-project",
			total: 1007,
			open: 504,
			merged: 503,
		});
	});

	test("failure keeps the last good calculation; unknown modules and invalid filters never write", async () => {
		seedPull(sqlite);
		const good = await snapshot("overview");
		sqlite.beforeBatch("INSERT INTO pr_stat_snapshots", () => {
			throw new Error("temporary write failure");
		});
		expect((await request("overview", true)).status).toBe(500);
		expect(await snapshot("overview", false)).toEqual({
			...good,
			calculatedAt: expect.any(Number),
		});
		expect((await request("unknown", true)).status).toBe(400);
		const invalid = await app.request(
			"http://localhost/api/insights/overview?filters=not-json",
			{ headers: { host: "localhost" } },
			{ DB: sqlite.db },
		);
		expect(invalid.status).toBe(400);
		expect(
			(await request("trend", true, { from: null, to: null })).status,
		).toBe(400);
	});
});
