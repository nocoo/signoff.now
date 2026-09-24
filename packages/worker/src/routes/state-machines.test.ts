import { afterEach, beforeEach, expect, test } from "bun:test";
import { machinePageSchema } from "@signoff/domain/query";
import app from "../index";
import { addObservation } from "../monitoring/observations";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
});
afterEach(() => sqlite.close());
function request(
	path = "/state-machines/live-project",
	method = "GET",
	body?: unknown,
) {
	return app.request(
		`http://localhost/api${path}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", SIGNOFF_DEMO_MODE: "1" },
	);
}
async function page(path?: string) {
	return machinePageSchema.parse(await (await request(path)).json());
}
test("persists policy instructions and priority with CAS, scopes and reevaluation", async () => {
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, 100);
	const initial = await page();
	const instructions = initial.instructions
		.map((p, i) => ({ ...p, description: `Instruction ${i}` }))
		.reverse();
	const save = () =>
		request(undefined, "PUT", {
			revision: initial.revision,
			repositoryId: null,
			instructions,
		});
	const responses = await Promise.all([save(), save()]);
	expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
	expect((await page()).instructions).toEqual(instructions);
	expect(
		sqlite.raw.query("SELECT input_revision FROM ai_evaluations").get(),
	).toMatchObject({ input_revision: 2 });
	seedProject(sqlite, { id: "other", projectKey: "Other" });
	seedPull(sqlite, { id: "other-pull", projectId: "other" });
	expect(
		(await page("/state-machines/other")).instructions.every(
			(i) => i.description === "",
		),
	).toBe(true);
	expect(
		(
			await request(undefined, "PUT", {
				revision: 2,
				repositoryId: null,
				instructions: [{ gateId: "foreign-policy", description: "bad" }],
			})
		).status,
	).toBe(400);
	expect(
		(await request("/state-machines/live-project?repositoryId=missing")).status,
	).toBe(404);
	expect((await request("/state-machines/missing")).status).toBe(404);
	expect((await request(undefined, "PUT", {})).status).toBe(400);
});
test("repository override can inherit again without deleting the project explanation", async () => {
	sqlite.raw
		.query(
			"INSERT OR IGNORE INTO workbench_repositories(project_id,repository_id,name) VALUES('live-project','repo-1','web-app')",
		)
		.run();
	const initial = await page();
	const instructions = initial.instructions.map((p) => ({
		...p,
		description: "Project guidance",
	}));
	await request(undefined, "PUT", {
		revision: 1,
		repositoryId: null,
		instructions,
	});
	const path = "/state-machines/live-project?repositoryId=repo-1";
	expect((await page(path)).inherited).toBe(true);
	expect(
		(
			await request(path, "PUT", {
				revision: 2,
				repositoryId: "repo-1",
				instructions: instructions.map((p) => ({
					...p,
					description: "Repo guidance",
				})),
			})
		).status,
	).toBe(200);
	expect((await page(path)).inherited).toBe(false);
	expect((await page()).instructions[0]?.description).toBe("Project guidance");
	await request(path, "PUT", {
		revision: 3,
		repositoryId: "repo-1",
		instructions: null,
	});
	expect((await page(path)).instructions).toEqual(instructions);
});
test("repository catalogs respect provider scopes and retain descriptions across renames", async () => {
	sqlite.raw
		.query(
			"UPDATE projects SET merge_requirements_json=? WHERE id='live-project'",
		)
		.run(
			JSON.stringify([
				{
					id: "stable",
					name: "Original",
					kind: "policy",
					sourceIds: ["source-1"],
					scope: [{ repositoryId: "repo-1" }],
				},
				{
					id: "foreign",
					name: "Foreign",
					kind: "policy",
					scope: [{ repositoryId: "other-repo" }],
				},
			]),
		);
	const path = "/state-machines/live-project?repositoryId=repo-1";
	const before = await page(path);
	expect(before.catalog.some((g) => g.name === "Foreign")).toBe(false);
	const instructions = before.instructions.map((i) => ({
		...i,
		description: "Preserved explanation",
	}));
	await request(path, "PUT", {
		revision: before.revision,
		repositoryId: "repo-1",
		instructions,
	});
	const current = JSON.parse(
		(
			sqlite.raw
				.query("SELECT snapshot FROM pull_requests WHERE id='pull-1'")
				.get() as { snapshot: string }
		).snapshot,
	);
	current.policies.push({
		id: "source-1",
		name: "Renamed",
		kind: "policy",
		required: true,
		state: "passed",
		detail: "",
		owner: "Owner",
	});
	sqlite.raw
		.query("UPDATE pull_requests SET snapshot=? WHERE id='pull-1'")
		.run(JSON.stringify(current));
	const after = await page(path);
	expect(after.catalog.find((g) => g.id === "stable")?.name).toBe("Renamed");
	expect(
		after.instructions.find((i) => i.gateId === "stable")?.description,
	).toBe("Preserved explanation");
});

test("history is scoped, bounded to 12 hours and reports evidence without invented readiness", async () => {
	const now = Math.floor(Date.now() / 1000);
	const pull = seedPull(sqlite, { id: "history-pull", observedAt: now });
	const next = { ...pull, state: "merged", draft: false, observedAt: now };
	sqlite.raw
		.query("UPDATE pull_requests SET snapshot=?,published_at=? WHERE id=?")
		.run(JSON.stringify(next), now, pull.id);
	sqlite.raw
		.query(
			"UPDATE pr_state_events SET observed_at=? WHERE pull_id=? AND from_snapshot IS NULL",
		)
		.run(now - 43201, pull.id);
	const response = await request(
		`/state-machines/live-project/history?pullId=${pull.id}`,
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		events: { from: { lifecycle: string }; to: { lifecycle: string } }[];
	};
	expect(body.events).toHaveLength(1);
	expect(body.events[0]?.to.lifecycle).toBe("merged");
	expect(body.events[0]?.to).not.toHaveProperty("readiness");
	expect(
		(await request(`/state-machines/other/history?pullId=${pull.id}`)).status,
	).toBe(404);
	expect(
		(
			await request(
				`/state-machines/live-project/history?source=sample&pullId=${pull.id}`,
			)
		).status,
	).toBe(404);
	expect((await request("/state-machines/live-project/history")).status).toBe(
		400,
	);
});
