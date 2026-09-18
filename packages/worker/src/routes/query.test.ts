import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	canonicalObservationKey,
	makeWatchRef,
} from "@signoff/domain/monitoring";
import {
	observationListSchema,
	pullDetailSchema,
	pullListSchema,
	repoListSchema,
} from "@signoff/domain/query";
import { Hono } from "hono";
import app from "../index";
import { addObservation, removeObservation } from "../monitoring/observations";
import {
	parseQuery,
	queryCollector,
	queryObservations,
	queryPulls,
	queryRepos,
} from "../monitoring/query";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import type { AppEnv } from "../types";
import { queryRoutes } from "./query";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
function request(
	path: string,
	method = "GET",
	body?: unknown,
	host = "localhost",
) {
	return app.request(
		`http://${host}${path}`,
		{
			method,
			headers: { host, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" },
	);
}
function seed() {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	return { project, pull };
}

describe("v1 cache queries", () => {
	test("internal project filters isolate retained watches after deleting and re-registering an external project", async () => {
		const { project, pull } = seed();
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
		expect(
			(
				await request(`/api/projects/${project.id}`, "DELETE", {
					revision: project.revision,
				})
			).status,
		).toBe(200);
		const replacement = seedProject(sqlite, { ...project, id: "replacement" });
		const current = seedPull(sqlite, {
			...pull,
			id: "replacement-pull",
			projectId: replacement.id,
			number: 2,
			externalId: "2",
		});
		await addObservation(sqlite.db, "cli", { pullId: current.id }, PR_TEST_NOW);
		for (const field of ["projectId", "project"]) {
			for (const id of [project.id, replacement.id]) {
				const filters = new URLSearchParams({
					includeStopped: "true",
					[field]: id,
				});
				const result = observationListSchema.parse(
					await (await request(`/api/query/v1/observations?${filters}`)).json(),
				);
				expect(result.data.map((o) => o.ref.projectId)).toEqual([id]);
				expect(result.page.total).toBe(1);
			}
		}
	});
	test("watch pages hydrate only selected snapshots even with substantial stopped history", async () => {
		const { project, pull } = seed();
		const insert = sqlite.raw.query(`INSERT INTO pr_observations
      (id,identity,activation_token,source,project_id,ref_json,pull_id,generation,active,added_at,stopped_at,stop_reason)
      VALUES(?,?,?,'cli',?,?,?,1,?,?,?,?)`);
		sqlite.raw.transaction(() => {
			for (let number = 1; number <= 1500; number++) {
				const active = number <= 25;
				const cached = seedPull(sqlite, {
					...pull,
					id: `watched-${number}`,
					number,
					externalId: String(number),
					state: active ? "open" : "merged",
				});
				const ref = makeWatchRef(project, cached.repository, number);
				insert.run(
					`watch-${number}`,
					canonicalObservationKey("cli", ref),
					`token-${number}`,
					project.id,
					JSON.stringify(ref),
					cached.id,
					Number(active),
					PR_TEST_NOW - 100,
					active ? null : PR_TEST_NOW,
					active ? null : "completed",
				);
			}
		})();
		let snapshotsRead = 0;
		const db = {
			prepare: sqlite.db.prepare.bind(sqlite.db),
			batch: async <T>(statements: D1PreparedStatement[]) => {
				const result = await sqlite.db.batch<T>(statements);
				snapshotsRead += result
					.flatMap((r) => r.results)
					.filter(
						(r) =>
							typeof r === "object" &&
							r !== null &&
							"snapshot" in r &&
							r.snapshot !== null,
					).length;
				return result;
			},
		};
		for (const [query, total, hydrated] of [
			["pending=true&limit=20", 0, 0],
			["limit=20", 25, 20],
			["limit=20&page=2", 25, 5],
			["includeStopped=true&limit=20&page=2", 1500, 20],
		] as const) {
			snapshotsRead = 0;
			const response = await queryObservations(
				db,
				"cli",
				parseQuery(new URLSearchParams(query)),
				PR_TEST_NOW,
			);
			expect(observationListSchema.parse(response).page.total).toBe(total);
			expect(snapshotsRead).toBe(hydrated);
		}
		snapshotsRead = 0;
		const lookup = await queryObservations(
			db,
			"cli",
			parseQuery(new URLSearchParams()),
			PR_TEST_NOW,
			{ pullId: "watched-1500" },
		);
		expect(lookup.data).toMatchObject({ id: "watch-1500", active: false });
		expect(snapshotsRead).toBe(1);
	});
	test("Unicode project and repository references agree across discovery, watches, lookup and scope filters", async () => {
		seedProject(sqlite, {
			organization: "test-org",
			projectKey: "Équipe",
			repositories: ["Éditeur"],
		});
		const pull = seedPull(sqlite, {
			draft: true,
			repository: { id: "repo-1", name: "Éditeur" },
		});
		sqlite.raw
			.query("UPDATE workbench_repositories SET aliases_json=?")
			.run(JSON.stringify(["Παλαιό"]));
		for (const name of ["Éditeur", "éditeur", "ÉDITEUR", "παλαιό", "repo-1"]) {
			const repositoryUrl = `https://dev.azure.com/TEST-ORG/${encodeURIComponent("ÉQUIPE")}/_git/${encodeURIComponent(name)}`;
			const url = `${repositoryUrl}/pullrequest/${pull.number}`;
			expect(
				(
					await request("/api/commands/v1/discover", "POST", {
						source: "live",
						repositoryUrl,
					})
				).status,
			).toBe(202);
			const added = await request("/api/commands/v1/observations", "POST", {
				source: "live",
				refs: [{ url }],
			});
			expect(await added.json()).toMatchObject({
				results: [
					{
						status: name === "Éditeur" ? "added" : "already_observed",
						observation: { pullId: pull.id },
					},
				],
			});
			for (const target of [{ url }, { repositoryUrl }])
				expect(
					(
						await request("/api/commands/v1/refresh", "POST", {
							source: "live",
							target,
						})
					).status,
				).toBe(202);
			const lookup = new URLSearchParams({
				repositoryUrl,
				number: String(pull.number),
			});
			for (const path of ["prs", "observations"])
				expect(
					(await request(`/api/query/v1/${path}/lookup?${lookup}`)).status,
				).toBe(200);
			const scopes: Record<string, string>[] = [
				{ repo: repositoryUrl },
				{ project: "équipe" },
				{ project: "ÉQUIPE" },
				{ repositoryId: name },
			];
			for (const scope of scopes) {
				const filters = new URLSearchParams({ draft: "include", ...scope });
				const response = await request(`/api/query/v1/prs?${filters}`);
				expect(
					pullListSchema.parse(await response.json()).data.map((p) => p.id),
				).toEqual([pull.id]);
				expect(
					repoListSchema.parse(
						await (await request(`/api/query/v1/repos?${filters}`)).json(),
					).data,
				).toHaveLength(1);
				expect(
					observationListSchema.parse(
						await (
							await request(`/api/query/v1/observations?${filters}`)
						).json(),
					).data,
				).toHaveLength(1);
			}
		}
		expect(
			sqlite.raw.query("SELECT COUNT(*) total FROM pr_observations").get(),
		).toEqual({ total: 1 });
		expect(
			sqlite.raw.query("SELECT COUNT(*) total FROM collection_jobs").get(),
		).toEqual({ total: 2 });
		// Metadata-only command/query handling never starts the queued provider work.
		expect(
			sqlite.raw
				.query(
					"SELECT COUNT(*) total FROM collection_jobs WHERE state<>'queued'",
				)
				.get(),
		).toEqual({ total: 0 });
	});
	test("watch pages retry concurrent retirement, while existing cursors reject a changed revision", async () => {
		const { pull } = seed();
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
		const other = seedPull(sqlite, {
			...pull,
			id: "other",
			number: 2,
			externalId: "2",
		});
		await addObservation(sqlite.db, "cli", { pullId: other.id }, PR_TEST_NOW);
		const first = observationListSchema.parse(
			await queryObservations(
				sqlite.db,
				"cli",
				parseQuery(new URLSearchParams("limit=1")),
				PR_TEST_NOW,
			),
		);
		sqlite.beforeBatch("WITH selected_observations", () => {
			sqlite.raw
				.query(
					"UPDATE pr_observations SET active=0,stopped_at=?,stop_reason='completed' WHERE pull_id=?",
				)
				.run(PR_TEST_NOW, other.id);
		});
		await expect(
			queryObservations(
				sqlite.db,
				"cli",
				parseQuery(
					new URLSearchParams({ limit: "1", cursor: first.page.nextCursor! }),
				),
				PR_TEST_NOW,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		sqlite.beforeBatch("WITH selected_observations", () => {
			sqlite.raw
				.query(
					"UPDATE pr_observations SET active=0,stopped_at=?,stop_reason='manual' WHERE pull_id=?",
				)
				.run(PR_TEST_NOW, pull.id);
		});
		const current = observationListSchema.parse(
			await queryObservations(
				sqlite.db,
				"cli",
				parseQuery(new URLSearchParams()),
				PR_TEST_NOW,
			),
		);
		expect(current.data).toEqual([]);
		expect(current.page.total).toBe(0);
		expect(current.dataRevision).not.toBe(first.dataRevision);
	});
	test("Unicode aliases that resolve to multiple watched repository identities are rejected", async () => {
		const { project, pull } = seed();
		const other = seedPull(sqlite, {
			...pull,
			id: "other",
			repository: { id: "repo-2", name: "other" },
		});
		for (const p of [pull, other])
			await addObservation(sqlite.db, "cli", { pullId: p.id }, PR_TEST_NOW);
		sqlite.raw
			.query("UPDATE workbench_repositories SET aliases_json=?")
			.run(JSON.stringify(["Éditeur"]));
		const params = new URLSearchParams({
			repositoryUrl: `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/%C3%A9diteur`,
			number: "1",
		});
		for (const path of ["prs", "observations"]) {
			const response = await request(`/api/query/v1/${path}/lookup?${params}`);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: { code: "REFERENCE_AMBIGUOUS" },
			});
		}
	});
	test("Unicode project scope changes are revision-fenced before PR and repository results are returned", async () => {
		seedProject(sqlite, { projectKey: "Équipe", repositories: [] });
		seedPull(sqlite);
		for (const path of ["prs", "repos"]) {
			sqlite.raw
				.query(
					"UPDATE projects SET project_key='Équipe',revision=revision+1 WHERE id='live-project'",
				)
				.run();
			seedPull(sqlite);
			sqlite.beforeBatch("SELECT pr.id,pr.project_id", () => {
				sqlite.raw
					.query(
						"UPDATE projects SET project_key='Replacement',revision=revision+1 WHERE id='live-project'",
					)
					.run();
			});
			const response = await request(
				`/api/query/v1/${path}?project=${encodeURIComponent("équipe")}`,
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				data: [],
				page: { total: 0 },
			});
		}
	});
	test("PR URL lookup cannot return a replacement project's facts after concurrent identity changes", async () => {
		const { project, pull } = seed();
		const repositoryUrl = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.name}`;
		sqlite.beforeBatch("SELECT pr.id,pr.project_id", () => {
			sqlite.raw
				.query(
					"UPDATE projects SET organization='replacement',revision=revision+1 WHERE id=?",
				)
				.run(project.id);
			seedPull(sqlite, pull);
		});
		const response = await request(
			`/api/query/v1/prs/lookup?${new URLSearchParams({ repositoryUrl, number: String(pull.number) })}`,
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			error: { code: "CACHE_MISS" },
		});
	});
	test("Sample command capability reflects local server configuration rather than frontend build mode", async () => {
		const routes = new Hono<AppEnv>().route("/query", queryRoutes);
		for (const [host, mode, enabled] of [
			["localhost", "1", true],
			["localhost", undefined, false],
			["signoff.now", "1", false],
		] as const) {
			const response = await routes.request(
				`http://${host}/query/collector`,
				{ headers: { host } },
				{ DB: sqlite.db, SIGNOFF_DEMO_MODE: mode },
			);
			expect(await response.json()).toMatchObject({
				sampleCommandsEnabled: enabled,
			});
		}
	});
	test("case-insensitive search finds Unicode author names in open and historical PRs", async () => {
		const { pull } = seed();
		for (const [index, state] of (
			["open", "merged", "closed"] as const
		).entries())
			seedPull(sqlite, {
				...pull,
				id: `unicode-${state}`,
				number: index + 2,
				externalId: String(index + 2),
				state,
				title: "Καλημέρα",
				author: { ...pull.author, id: "unicode", name: "Élodie" },
			});
		for (const q of [
			"Élodie",
			"ÉLODIE",
			"élodie",
			"lodie",
			"ΚΑΛΗΜΈΡΑ",
			"καλημέρα",
		])
			expect(
				(
					await queryPulls(
						sqlite.db,
						"cli",
						parseQuery(new URLSearchParams({ q, state: "all" })),
						PR_TEST_NOW,
					)
				).page.total,
			).toBe(3);
	});
	test("PR pages transfer only open facts and the requested history page, never all historical snapshots", async () => {
		seedProject(sqlite, { repositories: [] });
		for (let number = 1; number <= 1200; number++)
			seedPull(sqlite, {
				id: `history-${String(number).padStart(4, "0")}`,
				number,
				externalId: String(number),
				state: "merged",
			});
		let snapshotsRead = 0;
		const db = {
			prepare: sqlite.db.prepare.bind(sqlite.db),
			batch: async <T>(statements: D1PreparedStatement[]) => {
				const results = await sqlite.db.batch<T>(statements);
				snapshotsRead += results
					.flatMap((r) => r.results ?? [])
					.filter(
						(r) =>
							typeof r === "object" &&
							r !== null &&
							Object.hasOwn(r, "snapshot"),
					).length;
				return results;
			},
		};
		const open = await queryPulls(
			db,
			"cli",
			parseQuery(new URLSearchParams("state=open&limit=20")),
			PR_TEST_NOW,
		);
		expect(open.data).toEqual([]);
		expect(open.metrics.merged).toBe(1200);
		expect(open.authors).toHaveLength(1);
		expect(snapshotsRead).toBe(0);
		const history = await queryPulls(
			db,
			"cli",
			parseQuery(new URLSearchParams("state=all&limit=20")),
			PR_TEST_NOW,
		);
		expect(history.page.total).toBe(1200);
		expect(history.data).toHaveLength(20);
		expect(snapshotsRead).toBe(20);
	});
	test("facts and SQL pagination retry as one revision when a publication races the query", async () => {
		const { pull } = seed();
		sqlite.beforeBatch("WITH open_facts", () => {
			sqlite.raw
				.query(
					"UPDATE pull_requests SET state='merged',snapshot=json_set(snapshot,'$.state','merged') WHERE id=?",
				)
				.run(pull.id);
		});
		const result = await queryPulls(
			sqlite.db,
			"cli",
			parseQuery(new URLSearchParams()),
			PR_TEST_NOW,
		);
		expect(result.data).toEqual([]);
		expect(result.page.total).toBe(0);
		expect(result.metrics).toMatchObject({ open: 0, merged: 1 });
	});
	test("a cursor never silently crosses a revision, and continuously changing first pages stop retrying", async () => {
		const { pull } = seed();
		seedPull(sqlite, { ...pull, id: "second", number: 2, externalId: "2" });
		const first = await queryPulls(
			sqlite.db,
			"cli",
			parseQuery(new URLSearchParams("limit=1")),
			PR_TEST_NOW,
		);
		let changes = 0;
		const change = () => {
			changes++;
			sqlite.raw
				.query(
					"UPDATE pull_requests SET snapshot=json_set(snapshot,'$.title',?) WHERE id=?",
				)
				.run(`Revision ${changes}`, pull.id);
			sqlite.beforeBatch("WITH open_facts", change);
		};
		sqlite.beforeBatch("WITH open_facts", change);
		await expect(
			queryPulls(
				sqlite.db,
				"cli",
				parseQuery(
					new URLSearchParams({ limit: "1", cursor: first.page.nextCursor! }),
				),
				PR_TEST_NOW,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(changes).toBe(1);
		await expect(
			queryPulls(
				sqlite.db,
				"cli",
				parseQuery(new URLSearchParams()),
				PR_TEST_NOW,
			),
		).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });
		expect(changes).toBe(4);
	});
	test("server sort, status, freshness and missing-reference queries reflect cached PR facts", async () => {
		seedProject(sqlite, { repositories: [] });
		const common = {
			policies: [],
			builds: [],
			reviewers: [],
			requiredApprovals: 0,
			coverage: "complete" as const,
			mergeable: "clear" as const,
			checksObservedAt: PR_TEST_NOW,
		};
		seedPull(sqlite, {
			...common,
			id: "a",
			title: "Zulu",
			updatedAt: PR_TEST_NOW - 10,
			createdAt: PR_TEST_NOW - 100,
		});
		seedPull(sqlite, {
			...common,
			id: "b",
			number: 2,
			externalId: "2",
			title: "Alpha",
			checksObservedAt: null,
			checksInvalidated: true,
			updatedAt: PR_TEST_NOW - 5,
			createdAt: PR_TEST_NOW - 80,
		});
		for (const [sort, direction, expected] of [
			["title", "asc", ["b", "a"]],
			["title", "desc", ["a", "b"]],
			["readiness", "asc", ["a", "b"]],
			["progress", "asc", ["b", "a"]],
			["action", "asc", ["b", "a"]],
			["updated", "asc", ["a", "b"]],
			["oldest", "desc", ["b", "a"]],
		] as const) {
			const result = pullListSchema.parse(
				await (
					await request(`/api/query/v1/prs?sort=${sort}&direction=${direction}`)
				).json(),
			);
			expect(result.data.map((p) => p.id)).toEqual([...expected]);
		}
		const unknown = pullListSchema.parse(
			await (await request("/api/query/v1/prs?status=unknown")).json(),
		);
		expect(unknown.data[0]?.freshness.checksValidity).toBe("invalidated");
		expect(unknown.data[0]?.freshness.ageSeconds.checks).toBeNull();
		const detail = pullDetailSchema.parse(
			await (await request("/api/query/v1/prs/a")).json(),
		);
		expect(detail.data.requirements).toContainEqual(
			expect.objectContaining({ id: "merge-conflicts", state: "passed" }),
		);
		expect((await request("/api/query/v1/jobs/missing")).status).toBe(404);
		expect(
			(
				await request(
					"/api/query/v1/prs/lookup?repositoryUrl=https%3A%2F%2Fdev.azure.com%2Ftest-org%2FPlatform%2F_git%2Fweb-app&number=1",
				)
			).status,
		).toBe(200);
		expect(
			(
				await request(
					"/api/query/v1/prs/lookup?repositoryUrl=https%3A%2F%2Fdev.azure.com%2Ftest-org%2FPlatform%2F_git%2Fweb-app&number=999",
				)
			).status,
		).toBe(404);
		expect(
			(await request("/api/query/v1/observations/lookup?pullId=a")).status,
		).toBe(404);
	});
	test("collector auth state is retained even when the job preview is capped", async () => {
		seedProject(sqlite, { repositories: [] });
		sqlite.raw
			.query(
				"INSERT INTO collector_heartbeat(id,last_seen_at,state,message) VALUES(1,?,'ready','Idle')",
			)
			.run(PR_TEST_NOW);
		const first = seedPull(sqlite);
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: first.id },
			PR_TEST_NOW,
		);
		sqlite.raw
			.query(
				"UPDATE collection_jobs SET state='auth_required',message='az login required' WHERE id=?",
			)
			.run(added.job!.id);
		for (let n = 2; n <= 205; n++) {
			const pull = seedPull(sqlite, {
				id: `many-${n}`,
				number: n,
				externalId: String(n),
			});
			await addObservation(
				sqlite.db,
				"cli",
				{ pullId: pull.id },
				PR_TEST_NOW + n,
			);
		}
		const result = await queryCollector(sqlite.db, "cli", PR_TEST_NOW);
		expect(result.jobs).toHaveLength(200);
		expect(result.queue.authRequired).toBe(1);
		expect(result.connection).toMatchObject({
			state: "auth_required",
			message: "az login required",
		});
		sqlite.raw.exec(
			"UPDATE collection_jobs SET state='canceled'; INSERT INTO collection_project_rounds(project_id,last_completed_at) VALUES('live-project',100)",
		);
		expect(
			(await queryCollector(sqlite.db, "cli", PR_TEST_NOW)).rounds[0]
				?.nextDueAt,
		).toBe(new Date(400000).toISOString());
		expect(
			(await queryCollector(sqlite.db, "cli", PR_TEST_NOW + 66)).connection
				.state,
		).toBe("offline");
	});
	test("independent query blocks read only scoped or watched snapshots; catalog aggregates terminal counts in SQL", async () => {
		const { pull } = seed();
		await addObservation(sqlite.db, "cli", { pullId: pull.id }, PR_TEST_NOW);
		seedProject(sqlite, {
			id: "other",
			organization: "other",
			repositories: [],
		});
		for (let n = 2; n <= 30; n++)
			seedPull(sqlite, {
				id: `closed-${n}`,
				number: n,
				externalId: String(n),
				state: "merged",
			});
		seedPull(sqlite, { id: "other-pull", projectId: "other" });
		const reads: number[] = [];
		const db = {
			prepare: sqlite.db.prepare.bind(sqlite.db),
			batch: async <T>(statements: D1PreparedStatement[]) => {
				const result = await sqlite.db.batch<T>(statements);
				reads.push(
					result
						.flatMap((r) => r.results)
						.filter(
							(r) =>
								typeof r === "object" &&
								r !== null &&
								Object.hasOwn(r, "snapshot"),
						).length,
				);
				return result;
			},
		};
		await queryObservations(
			db,
			"cli",
			parseQuery(new URLSearchParams()),
			PR_TEST_NOW,
		);
		expect(reads.pop()).toBe(1);
		await queryPulls(
			db,
			"cli",
			parseQuery(new URLSearchParams({ org: "other" })),
			PR_TEST_NOW,
		);
		expect(reads.pop()).toBe(1);
		const catalog = await queryRepos(
			db,
			"cli",
			parseQuery(new URLSearchParams()),
			PR_TEST_NOW,
		);
		expect(reads.pop()).toBe(2);
		expect(
			catalog.data.find((r) => r.project.id === "live-project")?.counts,
		).toMatchObject({ open: 1, merged: 29, watching: 1 });
	});
	test("cached list and detail have complete source identity, timestamps and no write side effects", async () => {
		const { project, pull } = seed();
		const before = sqlite.raw.query("SELECT total_changes() AS n").get();
		const response = await request("/api/query/v1/prs");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = pullListSchema.parse(await response.json());
		expect(body.source).toBe("live");
		expect(body.page.total).toBe(1);
		expect(body.data[0]).toMatchObject({
			id: pull.id,
			provider: "ado",
			organization: { key: project.organization },
			project: { id: project.id, key: project.projectKey },
			repository: { id: pull.repository.id },
			number: 1,
			observation: null,
		});
		expect(body.data[0]?.freshness.listObservedAt).toBe(
			new Date(pull.observedAt * 1000).toISOString(),
		);
		const detail = pullDetailSchema.parse(
			await (await request(`/api/query/v1/prs/${pull.id}`)).json(),
		);
		expect(detail.data.description).toBe(pull.description);
		expect(sqlite.raw.query("SELECT total_changes() AS n").get()).toEqual(
			before,
		);
	});
	test("uses full server pagination beyond 1000 records and rejects revision/query-mismatched cursors", async () => {
		seedProject(sqlite, { repositories: [] });
		for (let n = 1; n <= 1205; n++)
			seedPull(sqlite, {
				id: `pr-${String(n).padStart(4, "0")}`,
				number: n,
				externalId: String(n),
			});
		const first = pullListSchema.parse(
			await (await request("/api/query/v1/prs?limit=200")).json(),
		);
		expect(first.page.total).toBe(1205);
		expect(first.data).toHaveLength(200);
		let cursor = first.page.nextCursor;
		const ids = new Set(first.data.map((p) => p.id));
		while (cursor) {
			const next = pullListSchema.parse(
				await (
					await request(
						`/api/query/v1/prs?limit=200&cursor=${encodeURIComponent(cursor)}`,
					)
				).json(),
			);
			for (const pr of next.data) ids.add(pr.id);
			cursor = next.page.nextCursor;
		}
		expect(ids.size).toBe(1205);
		expect(
			(
				await request(
					`/api/query/v1/prs?state=all&limit=200&cursor=${encodeURIComponent(first.page.nextCursor!)}`,
				)
			).status,
		).toBe(400);
		await addObservation(
			sqlite.db,
			"cli",
			{ pullId: first.data[0]!.id },
			PR_TEST_NOW,
		);
		const changed = await request(
			`/api/query/v1/prs?limit=200&cursor=${encodeURIComponent(first.page.nextCursor!)}`,
		);
		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({
			error: { code: "SNAPSHOT_CHANGED" },
		});
	});
	test("Draft is excluded from normal PR queries but included in the shared watch list", async () => {
		const { project, pull } = seed();
		const draft = seedPull(sqlite, {
			id: "draft",
			number: 2,
			externalId: "2",
			draft: true,
		});
		await addObservation(sqlite.db, "cli", { pullId: draft.id }, PR_TEST_NOW);
		expect(
			pullListSchema.parse(
				await (await request("/api/query/v1/prs?watching=true")).json(),
			).data,
		).toEqual([]);
		expect(
			pullListSchema.parse(
				await (
					await request("/api/query/v1/prs?watching=true&draft=include")
				).json(),
			).data[0]?.state,
		).toBe("draft");
		await addObservation(
			sqlite.db,
			"cli",
			{ url: makeWatchRef(project, pull.repository, 999).url },
			PR_TEST_NOW,
		);
		const watches = observationListSchema.parse(
			await (await request("/api/query/v1/observations")).json(),
		);
		expect(watches.page.total).toBe(2);
		expect(
			watches.data.some((o) => o.pull === null && o.ref.number === 999),
		).toBe(true);
	});
	test("repo navigation includes configured but undiscovered and empty repositories", async () => {
		seedProject(sqlite, { repositories: ["empty", "unknown"] });
		sqlite.raw.exec(
			"INSERT INTO workbench_repositories(project_id,repository_id,name,aliases_json,discovery_state,last_discovered_at) VALUES('live-project','empty-guid','empty','[]','complete',100)",
		);
		const repos = repoListSchema.parse(
			await (await request("/api/query/v1/repos")).json(),
		);
		expect(repos.data).toHaveLength(2);
		expect(repos.data.find((r) => r.repository.name === "empty")).toMatchObject(
			{ identityResolved: true, coverage: { state: "complete" } },
		);
		expect(
			repos.data.find((r) => r.repository.name === "unknown"),
		).toMatchObject({
			identityResolved: false,
			repository: { id: null },
			coverage: { state: "not_collected" },
		});
	});
	test("source, repository URL, multi-author and terminal filters remain independent", async () => {
		const { project, pull } = seed();
		seedPull(sqlite, {
			id: "merged",
			number: 2,
			externalId: "2",
			state: "merged",
			author: { id: "other", name: "Bob" },
		});
		seedProject(sqlite, {
			id: "sample",
			source: "demo",
			organization: "sample",
			repositories: [],
		});
		seedPull(sqlite, { id: "sample-pr", projectId: "sample" });
		const list = pullListSchema.parse(
			await (await request("/api/query/v1/prs?state=all")).json(),
		);
		expect(list.page.total).toBe(2);
		expect(list.metrics.merged).toBe(1);
		const params = new URLSearchParams({
			state: "all",
			author: list.data.find((p) => p.id === pull.id)!.author.key,
		});
		params.append(
			"repo",
			makeWatchRef(project, pull.repository, 1).url.replace(
				/\/pullrequest\/1$/,
				"",
			),
		);
		expect(
			pullListSchema.parse(
				await (await request(`/api/query/v1/prs?${params}`)).json(),
			).page.total,
		).toBe(1);
		expect(
			pullListSchema.parse(
				await (await request("/api/query/v1/prs?source=sample")).json(),
			).data[0]?.id,
		).toBe("sample-pr");
		expect((await request("/api/query/v1/prs/sample-pr")).status).toBe(404);
	});
	test.each([
		"?limit=0",
		"?limit=201",
		"?source=other",
		"?state=bogus",
		"?watching=yes",
		"?sort=bogus",
		"?cursor=garbage",
	])("rejects invalid query %s", async (query) => {
		expect((await request(`/api/query/v1/prs${query}`)).status).toBe(400);
	});
});

describe("v1 commands", () => {
	test("DELETE uses a safe If-Match generation, never a stale or foreign source watch", async () => {
		const { pull } = seed();
		const added = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: pull.id },
			PR_TEST_NOW,
		);
		const remove = (id: string, generation?: string) =>
			app.request(
				`http://localhost/api/commands/v1/observations/${id}`,
				{
					method: "DELETE",
					headers: {
						host: "localhost",
						...(generation ? { "if-match": generation } : {}),
					},
				},
				{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" },
			);
		expect((await remove(added.observation.id)).status).toBe(400);
		expect(
			(
				await remove(
					added.observation.id,
					'"99999999999999999999999999999999999999999999999999999999999"',
				)
			).status,
		).toBe(400);
		expect((await remove(added.observation.id, '"2"')).status).toBe(409);
		expect((await remove("missing", '"1"')).status).toBe(404);
		expect((await remove(added.observation.id, '"1"')).status).toBe(200);
		expect((await remove(added.observation.id, '"1"')).status).toBe(200);
	});
	test("malformed and oversized bodies, nonlocal Sample writes and unregistered discovery fail explicitly", async () => {
		seed();
		for (const [body, status] of [
			["{", 400],
			[JSON.stringify({ refs: [], extra: "x".repeat(524288) }), 413],
		] as const) {
			const response = await app.request(
				"http://localhost/api/commands/v1/observations",
				{
					method: "POST",
					headers: { host: "localhost", "content-type": "application/json" },
					body,
				},
				{ DB: sqlite.db },
			);
			expect(response.status).toBe(status);
		}
		const sample = await app.request(
			"http://localhost/api/commands/v1/refresh",
			{
				method: "POST",
				headers: { host: "localhost", "content-type": "application/json" },
				body: JSON.stringify({ source: "sample", target: { all: true } }),
			},
			{ DB: sqlite.db },
		);
		expect(sample.status).toBe(403);
		expect(
			(
				await request("/api/commands/v1/discover", "POST", {
					projectId: "missing",
				})
			).status,
		).toBe(404);
		expect(
			(
				await request("/api/commands/v1/refresh", "POST", {
					target: { pullId: "pull-1" },
				})
			).status,
		).toBe(409);
		const watch = await addObservation(
			sqlite.db,
			"cli",
			{ pullId: "pull-1" },
			PR_TEST_NOW,
		);
		await removeObservation(
			sqlite.db,
			"cli",
			watch.observation.id,
			1,
			PR_TEST_NOW,
		);
		expect(
			(
				await request("/api/commands/v1/refresh", "POST", {
					target: { pullId: "pull-1" },
				})
			).status,
		).toBe(409);
	});
	test("batch watch, lookup, generation-based removal and job receipts use one API", async () => {
		const { project, pull } = seed();
		seedPull(sqlite, {
			id: "closed",
			number: 2,
			externalId: "2",
			state: "closed",
		});
		const added = await request("/api/commands/v1/observations", "POST", {
			source: "live",
			refs: [{ pullId: pull.id }, { pullId: "closed" }],
		});
		expect(added.status).toBe(200);
		const body = (await added.json()) as {
			results: {
				status: string;
				observation: { id: string; generation: number };
				job: { id: string };
			}[];
		};
		expect(body.results.map((r) => r.status)).toEqual(["added", "rejected"]);
		const first = body.results[0]!;
		expect((await request(`/api/query/v1/jobs/${first.job.id}`)).status).toBe(
			200,
		);
		const lookup = await request(
			`/api/query/v1/observations/lookup?repositoryUrl=${encodeURIComponent(makeWatchRef(project, pull.repository, 1).url.replace(/\/pullrequest\/1$/, ""))}&number=1`,
		);
		expect(lookup.status).toBe(200);
		const removed = await request(
			"/api/commands/v1/observations/remove",
			"POST",
			{ source: "live", items: [{ id: first.observation.id, generation: 1 }] },
		);
		expect(await removed.json()).toMatchObject({
			results: [{ status: "removed" }],
		});
		expect(
			observationListSchema.parse(
				await (
					await request("/api/query/v1/observations?includeStopped=true")
				).json(),
			).data[0]?.stopReason,
		).toBe("manual");
	});
	test("discovery queues immediately without observing results; page heartbeat is gone", async () => {
		const { project } = seed();
		expect(
			(
				await request("/api/commands/v1/discover", "POST", {
					source: "live",
					projectId: project.id,
				})
			).status,
		).toBe(202);
		expect(
			(
				await request("/api/commands/v1/refresh", "POST", {
					source: "live",
					target: { all: true },
				})
			).status,
		).toBe(202);
		expect(
			observationListSchema.parse(
				await (await request("/api/query/v1/observations")).json(),
			).data,
		).toEqual([]);
		expect((await request("/api/collection/view", "POST", {})).status).toBe(
			410,
		);
	});
	test("invalid batch has zero writes and pipeline tokens cannot access queries or commands", async () => {
		seed();
		for (const refs of [
			[],
			Array.from({ length: 101 }, () => ({ pullId: "pull-1" })),
			[{ pullId: "pull-1", url: "https://example.com" }],
		])
			expect(
				(
					await request("/api/commands/v1/observations", "POST", {
						source: "live",
						refs,
					})
				).status,
			).toBe(400);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM pr_observations").get(),
		).toEqual({ n: 0 });
		for (const path of ["/api/query/v1/prs", "/api/commands/v1/observations"])
			expect(
				(
					await request(
						path,
						path.includes("commands") ? "POST" : "GET",
						undefined,
						"signoff-ingest.hexly.ai",
					)
				).status,
			).toBe(403);
	});
});
