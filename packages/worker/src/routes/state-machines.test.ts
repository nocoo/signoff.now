import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	machinePageSchema,
	machinePreviewSchema,
	machinePullPageSchema,
	pullDetailSchema,
} from "@signoff/domain/query";
import { defaultStateMachine } from "@signoff/domain/state-machine";
import app from "../index";
import { addObservation } from "../monitoring/observations";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

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
		`http://${host}/api${path}`,
		{
			method,
			headers: { host, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" },
	);
}
function seed() {
	const project = seedProject(sqlite);
	const pull = seedPull(sqlite, {
		mergeable: "clear",
		coverage: "complete",
		requiredApprovals: 0,
		policies: [],
		builds: [],
		reviewers: [],
	});
	return { project, pull, config: defaultStateMachine(project, [pull]) };
}
describe("state machine configuration and replay", () => {
	test("PR choices default to watched and paginate by stable identity across collection updates", async () => {
		seedProject(sqlite, { repositories: [] });
		for (let number = 1; number <= 25; number++) {
			seedPull(sqlite, {
				id: `pr-${number}`,
				number,
				externalId: String(number),
			});
			await addObservation(sqlite.db, "cli", { pullId: `pr-${number}` }, 100);
		}
		seedPull(sqlite, {
			id: "unwatched",
			number: 100,
			externalId: "100",
			title: "100%_ done",
		});
		const route = "/state-machines/live-project/pulls?repositoryId=repo-1";
		const first = machinePullPageSchema.parse(
			await (await request(route)).json(),
		);
		expect(first.data.map((pr) => pr.number)).toEqual(
			Array.from({ length: 20 }, (_, i) => 25 - i),
		);
		expect(first.data.every((pr) => pr.watched)).toBe(true);
		expect(first.nextCursor).toBeTruthy();
		// Removing an earlier row and changing collection clocks cannot skip the next PR.
		sqlite.raw.query("DELETE FROM pull_requests WHERE id='pr-25'").run();
		sqlite.raw.query("UPDATE pull_requests SET published_at=999").run();
		const second = machinePullPageSchema.parse(
			await (
				await request(
					`${route}&cursor=${encodeURIComponent(first.nextCursor!)}`,
				)
			).json(),
		);
		expect(second.data.map((pr) => pr.number)).toEqual([5, 4, 3, 2, 1]);
		expect(second.nextCursor).toBeNull();
		const searched = machinePullPageSchema.parse(
			await (await request(`${route}&watched=false&q=%25_`)).json(),
		);
		expect(searched.data.map((pr) => pr.id)).toEqual(["unwatched"]);
		expect(searched.data[0]?.watched).toBe(false);
		expect(
			machinePullPageSchema
				.parse(await (await request(`${route}&q=%2312`)).json())
				.data.map((pr) => pr.number),
		).toEqual([12]);
		expect(
			(
				await request(
					`${route}&watched=false&cursor=${encodeURIComponent(first.nextCursor!)}`,
				)
			).status,
		).toBe(400);
	});
	test("PR choices isolate repositories and sources, validate cursors and include same-number identities", async () => {
		seedProject(sqlite);
		seedProject(sqlite, {
			id: "sample-project",
			source: "demo",
			organization: "sample-org",
		});
		seedPull(sqlite, { id: "sample-pr", projectId: "sample-project" });
		for (let i = 0; i < 21; i++)
			seedPull(sqlite, {
				id: `same-${String(i).padStart(2, "0")}`,
				repository: { id: `repo-${i}`, name: `Repository ${i}` },
			});
		const route = "/state-machines/live-project/pulls?watched=false";
		const first = machinePullPageSchema.parse(
			await (await request(route)).json(),
		);
		const second = machinePullPageSchema.parse(
			await (
				await request(
					`${route}&cursor=${encodeURIComponent(first.nextCursor!)}`,
				)
			).json(),
		);
		expect([...first.data, ...second.data].map((pr) => pr.id)).toEqual(
			Array.from(
				{ length: 21 },
				(_, i) => `same-${String(i).padStart(2, "0")}`,
			),
		);
		expect(
			machinePullPageSchema
				.parse(await (await request(`${route}&repositoryId=repo-1`)).json())
				.data.map((pr) => pr.id),
		).toEqual(["same-01"]);
		for (const query of [
			"cursor=bad",
			"cursor=%7B%7D",
			"watched=maybe",
			"source=other",
			`q=${"a".repeat(1001)}`,
		])
			expect(
				(await request(`/state-machines/live-project/pulls?${query}`)).status,
			).toBe(400);
		expect((await request(`${route}&source=sample`)).status).toBe(404);
		expect((await request("/state-machines/missing/pulls")).status).toBe(404);
		expect(
			(await request(route, "GET", undefined, "signoff-ingest.example.com"))
				.status,
		).toBe(403);
		expect(
			sqlite.raw.query("SELECT count(*) n FROM collection_jobs").get(),
		).toEqual({ n: 0 });
	});
	test("a selected historical PR stays inside the bounded replay and draft preview", async () => {
		const { pull, config } = seed();
		const old = seedPull(sqlite, {
			...pull,
			id: "old-pr",
			externalId: "3000",
			number: 3000,
			state: "closed",
			updatedAt: 1,
		});
		sqlite.raw.transaction(() => {
			for (let i = 2; i <= 2001; i++)
				seedPull(sqlite, {
					...pull,
					id: `pr-${i}`,
					externalId: String(i),
					number: i,
				});
		})();
		const route = `/state-machines/live-project?repositoryId=repo-1&pullId=${old.id}`;
		const page = machinePageSchema.parse(await (await request(route)).json());
		expect(page.total).toBe(2002);
		expect(page.evaluatedCount).toBe(2000);
		expect(page.truncated).toBe(true);
		expect(page.selectedPull?.id).toBe(old.id);
		expect(page.evaluations[0]?.id).toBe(old.id);
		const choices = machinePullPageSchema.parse(
			await (
				await request("/state-machines/live-project/pulls?watched=false&q=3000")
			).json(),
		);
		expect(choices.data.map((pr) => pr.id)).toEqual([old.id]);
		const preview = machinePreviewSchema.parse(
			await (
				await request(
					`/state-machines/live-project/preview?pullId=${old.id}`,
					"POST",
					{ revision: 1, repositoryId: "repo-1", config },
				)
			).json(),
		);
		expect(preview.evaluations[0]?.id).toBe(old.id);
		expect(preview.evaluations).toHaveLength(2000);
	});
	test("empty scopes, invalid bodies and missing versions remain bounded read-only errors", async () => {
		seedProject(sqlite);
		const empty = machinePageSchema.parse(
			await (await request("/state-machines/live-project")).json(),
		);
		expect(empty.evaluations).toHaveLength(0);
		expect(
			(await request("/state-machines/live-project/versions/99")).status,
		).toBe(404);
		expect(
			(await request("/state-machines/live-project/versions/bad")).status,
		).toBe(400);
		for (const body of ["{", "x".repeat(256 * 1024 + 1)]) {
			const response = await app.request(
				"http://localhost/api/state-machines/live-project",
				{
					method: "PATCH",
					headers: { host: "localhost", "content-type": "application/json" },
					body,
				},
				{ DB: sqlite.db },
			);
			expect([400, 413]).toContain(response.status);
		}
		expect(
			(
				await request("/state-machines/live-project", "PATCH", {
					revision: 1,
					repositoryId: null,
					config: null,
				})
			).status,
		).toBe(200);
	});
	test("catalogs omit other repository scopes and legacy versions can be loaded for a draft", async () => {
		const { config } = seed();
		sqlite.raw.query("UPDATE projects SET merge_requirements_json=?").run(
			JSON.stringify([
				{
					id: "ours",
					name: "Ours",
					kind: "policy",
					scope: [{ repositoryId: "repo-1" }],
				},
				{
					id: "other",
					name: "Other",
					kind: "policy",
					scope: [{ repositoryId: "other-repo" }],
				},
			]),
		);
		const page = machinePageSchema.parse(
			await (
				await request("/state-machines/live-project?repositoryId=repo-1")
			).json(),
		);
		expect(page.catalog.some((g) => g.name === "Other")).toBe(false);
		const body = { revision: 1, repositoryId: "repo-1", config };
		const preview = machinePreviewSchema.parse(
			await (
				await request("/state-machines/live-project/preview", "POST", body)
			).json(),
		);
		expect(preview.evaluatedCount).toBe(1);
		const legacy = (await (
			await request("/state-machines/live-project/versions/1")
		).json()) as { config: typeof config };
		expect(legacy.config.states).toHaveLength(9);
	});
	test("concurrent editors cannot overwrite each other, and observation writes roll back with publication", async () => {
		const { pull, config } = seed();
		const saved = await Promise.all([
			request("/state-machines/live-project", "PATCH", {
				revision: 1,
				repositoryId: null,
				config,
			}),
			request("/state-machines/live-project", "PATCH", {
				revision: 1,
				repositoryId: "repo-1",
				config,
			}),
		]);
		expect(saved.map((r) => r.status).sort()).toEqual([200, 409]);
		expect(
			sqlite.raw.query("SELECT count(*) n FROM state_machine_versions").get(),
		).toEqual({ n: 2 });
		await expect(
			sqlite.db.batch([
				sqlite.db
					.prepare("UPDATE pull_requests SET snapshot=? WHERE id=?")
					.bind(JSON.stringify({ ...pull, state: "merged" }), pull.id),
				sqlite.db.prepare("UPDATE projects SET state_machine_revision=0"),
			]),
		).rejects.toThrow();
		expect(
			sqlite.raw.query("SELECT count(*) n FROM pr_state_events").get(),
		).toEqual({ n: 1 });
		for (let i = 0; i < 35; i++)
			sqlite.raw
				.query("UPDATE pull_requests SET snapshot=? WHERE id=?")
				.run(JSON.stringify({ ...pull, headSha: `head-${i}` }), pull.id);
		expect(
			sqlite.raw.query("SELECT count(*) n FROM pr_state_events").get(),
		).toEqual({ n: 30 });
	});
	test("preview is read-only; saving uses independent CAS and changes the shared query result", async () => {
		const { pull, config } = seed();
		config.states.find((s) => s.id === "ready")!.label = "Ship it";
		const body = { revision: 1, repositoryId: "repo-1", config };
		const before = sqlite.raw.query("SELECT snapshot FROM pull_requests").all();
		const preview = machinePreviewSchema.parse(
			await (
				await request("/state-machines/live-project/preview", "POST", body)
			).json(),
		);
		expect(preview.changed).toBe(1);
		expect(preview.changes[0]?.after.label).toBe("Ship it");
		expect(
			sqlite.raw.query("SELECT state_machine_revision FROM projects").get(),
		).toEqual({ state_machine_revision: 1 });
		expect(
			(await request("/state-machines/live-project", "PATCH", body)).status,
		).toBe(200);
		expect(
			(await request("/state-machines/live-project", "PATCH", body)).status,
		).toBe(409);
		const page = machinePageSchema.parse(
			await (
				await request(
					`/state-machines/live-project?repositoryId=repo-1&pullId=${pull.id}`,
				)
			).json(),
		);
		expect(page.revision).toBe(2);
		expect(page.inherited).toBe(false);
		expect(page.evaluations[0]?.readiness.label).toBe("Ship it");
		expect(page.history).toHaveLength(2);
		const detail = pullDetailSchema.parse(
			await (await request(`/query/v1/prs/${pull.id}`)).json(),
		);
		expect(detail.data.readiness.label).toBe("Ship it");
		expect(detail.data.readiness.machineRevision).toBe(2);
		expect(
			sqlite.raw.query("SELECT snapshot FROM pull_requests").all(),
		).toEqual(before);
		expect(sqlite.raw.query("SELECT revision FROM projects").get()).toEqual({
			revision: 1,
		});
		expect(
			sqlite.raw.query("SELECT count(*) n FROM pr_observations").get(),
		).toEqual({ n: 0 });
		expect(
			sqlite.raw.query("SELECT count(*) n FROM collection_jobs").get(),
		).toEqual({ n: 0 });
	});
	test("repo overrides can return to inheritance and older versions can be previewed before restoration", async () => {
		const { config } = seed();
		config.states.find((s) => s.id === "ready")!.label = "Project ready";
		expect(
			(
				await request("/state-machines/live-project", "PATCH", {
					revision: 1,
					repositoryId: null,
					config,
				})
			).status,
		).toBe(200);
		config.states.find((s) => s.id === "ready")!.label = "Repo ready";
		await request("/state-machines/live-project", "PATCH", {
			revision: 2,
			repositoryId: "repo-1",
			config,
		});
		await request("/state-machines/live-project", "PATCH", {
			revision: 3,
			repositoryId: "repo-1",
			config: null,
		});
		const page = machinePageSchema.parse(
			await (
				await request("/state-machines/live-project?repositoryId=repo-1")
			).json(),
		);
		expect(page.inherited).toBe(true);
		expect(page.evaluations[0]?.readiness.label).toBe("Project ready");
		const version = (await (
			await request(
				"/state-machines/live-project/versions/3?repositoryId=repo-1",
			)
		).json()) as { config: typeof config };
		expect(version.config.states.find((s) => s.id === "ready")?.label).toBe(
			"Repo ready",
		);
	});
	test("observation history is atomic, ignores polling clocks and uses the rule version at observation time", async () => {
		const { pull, config } = seed();
		const update = (snapshot: typeof pull) =>
			sqlite.raw
				.query(
					"UPDATE pull_requests SET snapshot=?, version=version+1 WHERE id=?",
				)
				.run(JSON.stringify(snapshot), pull.id);
		update({ ...pull, observedAt: pull.observedAt + 30 });
		expect(
			sqlite.raw.query("SELECT count(*) n FROM pr_state_events").get(),
		).toEqual({ n: 1 });
		config.states.find((s) => s.id === "ready")!.label = "New label";
		await request("/state-machines/live-project", "PATCH", {
			revision: 1,
			repositoryId: null,
			config,
		});
		update({ ...pull, state: "merged" });
		const page = machinePageSchema.parse(
			await (
				await request(`/state-machines/live-project?pullId=${pull.id}`)
			).json(),
		);
		expect(page.transitions).toHaveLength(2);
		expect(page.transitions[0]).toMatchObject({
			cause: "observation",
			from: { label: "New label" },
			to: { kind: "merged" },
			ruleRevision: 2,
		});
		expect(page.transitions[1]?.to.label).toBe("Ready to merge");
	});
	test("validation and scope guards reject invalid rules and machine-token management", async () => {
		const { config } = seed();
		for (const [path, body, status] of [
			[
				"/state-machines/missing",
				{ revision: 1, repositoryId: null, config },
				404,
			],
			[
				"/state-machines/live-project?source=sample",
				{ revision: 1, repositoryId: null, config },
				404,
			],
			[
				"/state-machines/live-project",
				{ revision: 1, repositoryId: "missing", config },
				404,
			],
			[
				"/state-machines/live-project",
				{ revision: 1, repositoryId: null, config: {} },
				400,
			],
		] as const)
			expect((await request(path, "PATCH", body)).status).toBe(status);
		expect(
			(
				await request(
					"/state-machines/live-project",
					"PATCH",
					{ revision: 1, repositoryId: null, config },
					"signoff-ingest.example.com",
				)
			).status,
		).toBe(403);
	});
});
