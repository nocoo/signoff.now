import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	machinePageSchema,
	machinePreviewSchema,
	pullDetailSchema,
} from "@signoff/domain/query";
import { defaultStateMachine } from "@signoff/domain/state-machine";
import app from "../index";
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
