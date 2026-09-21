import { afterEach, beforeEach, expect, test } from "bun:test";
import { parsePullReference } from "@signoff/domain/monitoring";
import {
	batchCommandSchema,
	observationListSchema,
	pullDetailSchema,
	repoListSchema,
} from "@signoff/domain/query";
import app from "../index";
import {
	addObservation,
	removeObservation,
	resolveObservation,
	resolvePull,
} from "../monitoring/observations";
import { readJob } from "../monitoring/store";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
const providerId = "11111111-1111-1111-1111-111111111111";
const collisionId = "22222222-2222-2222-2222-222222222222";
function request(path: string, method = "GET", body?: unknown) {
	return app.request(
		`http://localhost${path}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db },
	);
}
async function fixture(id: string) {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, {
		repository: { id, name: "main-repository" },
	});
	const collision = seedPull(sqlite, {
		id: "collision-pull",
		number: 2,
		externalId: "2",
		repository: { id: collisionId, name: id },
	});
	const watch = await addObservation(
		sqlite.db,
		"cli",
		{ pullId: pull.id },
		PR_TEST_NOW,
	);
	await addObservation(sqlite.db, "cli", { pullId: collision.id }, PR_TEST_NOW);
	const url = `https://dev.azure.com/test-org/Platform/_git/${id}`;
	return { project, pull, collision, watch, url };
}

test.each([
	"guid-name",
	"retained-alias",
])("emitted ADO URLs preserve identity through lookups and watch commands (%s)", async (collision) => {
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite, { repository: { id: providerId, name: "renamed" } });
	const name = collision === "guid-name" ? providerId : "shared";
	const pull = seedPull(sqlite, {
		id: "target",
		number: 2,
		externalId: "2",
		repository: { id: collisionId, name },
	});
	if (collision === "retained-alias")
		sqlite.raw
			.query(
				"UPDATE workbench_repositories SET aliases_json=? WHERE repository_id=?",
			)
			.run(JSON.stringify(["shared", "renamed"]), providerId);
	const cached = pullDetailSchema.parse(
		await (await request(`/api/query/v1/prs/${pull.id}`)).json(),
	).data;
	const catalog = repoListSchema.parse(
		await (await request("/api/query/v1/repos")).json(),
	);
	const repository = catalog.data.find(
		(item) => item.repository.id === collisionId,
	)!;
	const parsed = parsePullReference(cached.url);
	expect(parsed.repository).toBe(collisionId);
	expect(cached.repository.url).toBe(parsed.repositoryUrl);
	expect(repository.repository.url).toBe(parsed.repositoryUrl);
	const lookup = await request(
		`/api/query/v1/prs/lookup?${new URLSearchParams({ repositoryUrl: parsed.repositoryUrl, number: String(parsed.number) })}`,
	);
	expect(lookup.status).toBe(200);
	expect(pullDetailSchema.parse(await lookup.json()).data.id).toBe(pull.id);
	const added = batchCommandSchema.parse(
		await (
			await request("/api/commands/v1/observations", "POST", {
				refs: [{ url: cached.url }],
			})
		).json(),
	);
	expect(added.results[0]?.observation).toMatchObject({
		pullId: pull.id,
		ref: { repository: { id: collisionId } },
	});
	expect(
		sqlite.raw
			.query(
				"SELECT json_extract(ref_json,'$.repository.id') repository_id,json_extract(ref_json,'$.number') pr_number FROM pr_observations WHERE active=1",
			)
			.all(),
	).toEqual([{ repository_id: collisionId, pr_number: 2 }]);
	// Upgrades may retain an older, name-based URL in an otherwise complete ref.
	const observation = added.results[0]!.observation!;
	const legacyRef = {
		...observation.ref,
		url: `https://dev.azure.com/test-org/Platform/_git/${name}/pullrequest/2`,
	};
	sqlite.raw
		.query("UPDATE pr_observations SET ref_json=? WHERE id=?")
		.run(JSON.stringify(legacyRef), observation.id);
	const watches = observationListSchema.parse(
		await (await request("/api/query/v1/observations")).json(),
	);
	expect(watches.data[0]?.pr.url).toBe(cached.url);
	expect(
		JSON.parse(
			(
				sqlite.raw
					.query("SELECT ref_json FROM pr_observations WHERE id=?")
					.get(observation.id) as { ref_json: string }
			).ref_json,
		).url,
	).toBe(legacyRef.url);
});

test.each([
	providerId,
	"repo-stable-a",
])("stable repository ID wins across queries, discovery, refresh and project scope: %s", async (id) => {
	const { project, pull, collision, url } = await fixture(id);
	const scopes: Record<string, string>[] = [
		{ repositoryId: id },
		{ repo: url },
	];
	for (const filters of scopes) {
		for (const path of ["prs", "repos", "observations"]) {
			const response = await request(
				`/api/query/v1/${path}?${new URLSearchParams(filters)}`,
			);
			expect(response.status).toBe(200);
			const result = (await response.json()) as {
				page: { total: number };
				data: {
					repository?: { id: string };
					pr?: { repository: { id: string } };
				}[];
			};
			expect(result.page.total).toBe(1);
			expect(
				result.data.map((r) => r.repository?.id ?? r.pr?.repository.id),
			).toEqual([id]);
		}
	}
	const discovered = await request("/api/commands/v1/discover", "POST", {
		repositoryUrl: url,
	});
	expect(discovered.status).toBe(202);
	const receipt = (await discovered.json()) as { jobs: { id: string }[] };
	expect(
		JSON.parse((await readJob(sqlite.db, receipt.jobs[0]!.id)).scope_json),
	).toEqual([id]);
	const added = await request("/api/commands/v1/observations", "POST", {
		refs: [{ url: `${url}/pullrequest/1` }],
	});
	expect(await added.json()).toMatchObject({
		results: [{ status: "already_observed", observation: { pullId: pull.id } }],
	});
	const refreshed = await request("/api/commands/v1/refresh", "POST", {
		target: { repositoryUrl: url },
	});
	expect(refreshed.status).toBe(202);
	const refreshedBody = (await refreshed.json()) as { jobs: { id: string }[] };
	expect(refreshedBody.jobs).toHaveLength(1);
	expect(
		JSON.parse(
			(await readJob(sqlite.db, refreshedBody.jobs[0]!.id)).scope_json,
		),
	).toEqual([id]);
	const patch = await request(`/api/projects/${project.id}`, "PATCH", {
		revision: project.revision,
		repositories: [id],
	});
	expect(patch.status).toBe(200);
	expect(
		sqlite.raw.query("SELECT repository_id FROM workbench_repositories").all(),
	).toEqual([{ repository_id: id }]);
	expect(
		sqlite.raw
			.query("SELECT pull_id FROM pr_observations WHERE active=1")
			.all(),
	).toEqual([{ pull_id: pull.id }]);
	expect(
		sqlite.raw
			.query("SELECT id FROM pull_requests WHERE id=?")
			.get(collision.id),
	).toBeNull();
	expect(
		(
			await request("/api/commands/v1/discover", "POST", {
				projectId: project.id,
			})
		).status,
	).toBe(202);
});

test.each([
	"active",
	"unwatched",
	"stopped",
	"deleted",
])("a missing PR never falls back to a repository named after an ID (%s identity context)", async (context) => {
	const { project, pull, watch, url } = await fixture("repo-stable-a");
	if (context === "unwatched")
		sqlite.raw
			.query("DELETE FROM pr_observations WHERE id=?")
			.run(watch.observation.id);
	if (context === "stopped")
		await removeObservation(
			sqlite.db,
			"cli",
			watch.observation.id,
			1,
			PR_TEST_NOW,
		);
	if (context === "deleted")
		sqlite.raw.query("DELETE FROM projects WHERE id=?").run(project.id);
	for (const path of ["prs", "observations"]) {
		const response = await request(
			`/api/query/v1/${path}/lookup?${new URLSearchParams({ repositoryUrl: url, number: "2" })}`,
		);
		expect(response.status).toBe(404);
	}
	await expect(
		resolveObservation(sqlite.db, "cli", { url: `${url}/pullrequest/2` }),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	const filtered = await request(
		`/api/query/v1/observations?${new URLSearchParams({ repo: url })}`,
	);
	expect(await filtered.json()).toMatchObject({
		page: { total: context === "active" ? 1 : 0 },
	});
	if (context === "deleted") {
		const stopped = await request(
			`/api/query/v1/observations/lookup?${new URLSearchParams({ repositoryUrl: url, number: "1" })}`,
		);
		expect(await stopped.json()).toMatchObject({
			data: {
				watch: { id: watch.observation.id, active: false },
				pr: { title: null },
			},
		});
	} else {
		// Even an uncached URL watch must preserve A's identity rather than B's PR #2.
		expect(
			await resolvePull(sqlite.db, "cli", { url: `${url}/pullrequest/2` }),
		).toMatchObject({
			ref: { repository: { id: pull.repository.id }, number: 2 },
			pullId: null,
		});
	}
});

test("repositoryId filters accept IDs only; names remain available through repository URLs", async () => {
	await fixture(providerId);
	for (const path of ["prs", "repos", "observations"]) {
		const result = await request(
			`/api/query/v1/${path}?repositoryId=main-repository`,
		);
		expect(await result.json()).toMatchObject({ data: [], page: { total: 0 } });
	}
});

test("cached PR IDs and repository URLs both enforce an ID-configured project scope", async () => {
	const { project, pull, collision } = await fixture("repo-stable-a");
	await request(`/api/projects/${project.id}`, "PATCH", {
		revision: project.revision,
		repositories: [pull.repository.id],
	});
	seedPull(sqlite, collision);
	for (const ref of [
		{ pullId: collision.id },
		{
			url: `https://dev.azure.com/test-org/Platform/_git/${collision.repository.id}/pullrequest/2`,
		},
	])
		await expect(resolvePull(sqlite.db, "cli", ref)).rejects.toMatchObject({
			code: "REPOSITORY_NOT_TRACKED",
		});
});

test("alias ambiguity is resolved before the requested PR number filters out a repository", async () => {
	const { url } = await fixture(providerId);
	const alias = url.replace(providerId, "old-name");
	const params = new URLSearchParams({ repositoryUrl: alias, number: "2" });
	sqlite.raw.exec(
		"UPDATE workbench_repositories SET aliases_json='[\"old-name\"]'",
	);
	for (const path of ["prs", "observations"]) {
		const response = await request(`/api/query/v1/${path}/lookup?${params}`);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: "REFERENCE_AMBIGUOUS" },
		});
	}
	await expect(
		resolveObservation(sqlite.db, "cli", { url: `${alias}/pullrequest/2` }),
	).rejects.toMatchObject({ code: "REFERENCE_AMBIGUOUS" });
});
