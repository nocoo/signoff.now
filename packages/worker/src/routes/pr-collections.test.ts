import { afterEach, beforeEach, expect, test } from "bun:test";
import { prCollectionSchema } from "@signoff/domain/pr-collections";
import app from "../index";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [] });
});
afterEach(() => sqlite.close());
const draft = {
	name: "Release confidence",
	description: "Track tests through merge.",
	color: "violet",
	icon: "flask",
};
const request = (path = "", method = "GET", body?: unknown, source = "live") =>
	app.request(
		`http://localhost/api/pr-collections${path}${path.includes("?") ? "&" : "?"}source=${source}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db },
	);
async function create(name = draft.name) {
	const response = await request("", "POST", { ...draft, name });
	expect(response.status).toBe(201);
	return prCollectionSchema.parse(await response.json());
}

test("collection CRUD uses revisions, validates input and isolates data sources", async () => {
	const c = await create();
	expect(
		(await request("", "POST", { ...draft, name: draft.name.toUpperCase() }))
			.status,
	).toBe(409);
	expect((await request("", "POST", { ...draft, name: " " })).status).toBe(400);
	expect(
		(await request("", "POST", { ...draft, color: "<script>" })).status,
	).toBe(400);
	expect((await request(`/${c.id}`, "GET", undefined, "sample")).status).toBe(
		404,
	);
	expect(
		(await request(`/${c.id}`, "PATCH", { ...draft, name: "QA", revision: 2 }))
			.status,
	).toBe(409);
	const edited = prCollectionSchema.parse(
		await (
			await request(`/${c.id}`, "PATCH", { ...draft, name: "QA", revision: 1 })
		).json(),
	);
	expect(edited.name).toBe("QA");
	expect(edited.revision).toBe(2);
	expect((await request(`/${c.id}?revision=1`, "DELETE")).status).toBe(409);
	expect((await request(`/${c.id}?revision=2`, "DELETE")).status).toBe(200);
	expect((await request(`/${c.id}`)).status).toBe(404);
});

test("multiple collections keep all lifecycle states and exact merge progress without adding watches", async () => {
	const pulls = [
		seedPull(sqlite),
		seedPull(sqlite, { id: "draft", externalId: "2", number: 2, draft: true }),
		seedPull(sqlite, {
			id: "merged",
			externalId: "3",
			number: 3,
			state: "merged",
		}),
		seedPull(sqlite, {
			id: "closed",
			externalId: "4",
			number: 4,
			state: "closed",
		}),
	];
	const first = await create(),
		second = await create("Regression");
	const changed = prCollectionSchema.parse(
		await (
			await request(`/${first.id}/members`, "PUT", {
				revision: 1,
				action: "add",
				pullIds: pulls.map((p) => p.id),
			})
		).json(),
	);
	expect(changed.counts).toEqual({
		total: 4,
		open: 1,
		draft: 1,
		merged: 1,
		closed: 1,
	});
	expect(
		(
			await request(`/${second.id}/members`, "PUT", {
				revision: 1,
				action: "add",
				pullIds: [pulls[0]!.id],
			})
		).status,
	).toBe(200);
	const memberships = (await (
		await request(`/memberships?pullId=${pulls[0]!.id}`)
	).json()) as { items: unknown[] };
	expect(memberships.items).toHaveLength(2);
	const list = await app.request(
		`http://localhost/api/query/v1/prs?source=live&collectionId=${first.id}&state=all&draft=include&limit=2`,
		{ headers: { host: "localhost" } },
		{ DB: sqlite.db },
	);
	const page = (await list.json()) as {
		data: { id: string }[];
		page: { total: number };
	};
	expect(list.status).toBe(200);
	expect(page.page.total).toBe(4);
	expect(page.data).toHaveLength(2);
	expect(
		(
			await request(`/${first.id}/members`, "PUT", {
				revision: 1,
				action: "remove",
				pullIds: [pulls[0]!.id],
			})
		).status,
	).toBe(409);
	expect(
		(
			await request(`/${first.id}/members`, "PUT", {
				revision: 2,
				action: "remove",
				pullIds: [pulls[0]!.id],
			})
		).status,
	).toBe(200);
	expect((await request(`/${first.id}?revision=3`, "DELETE")).status).toBe(200);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pr_collection_members").get(),
	).toEqual({ n: 1 });
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pull_requests").get(),
	).toEqual({ n: 4 });
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pr_observations").get(),
	).toEqual({ n: 0 });
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM collection_jobs").get(),
	).toEqual({ n: 0 });
});

test("mixed-source or missing members are rejected atomically; rediscovery preserves membership", async () => {
	const pull = seedPull(sqlite);
	seedProject(sqlite, {
		id: "sample-project",
		source: "demo",
		organization: "sample-org",
	});
	seedPull(sqlite, { id: "sample-pull", projectId: "sample-project" });
	const c = await create();
	for (const id of ["missing", "sample-pull"])
		expect(
			(
				await request(`/${c.id}/members`, "PUT", {
					revision: 1,
					action: "add",
					pullIds: [pull.id, id],
				})
			).status,
		).toBe(409);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pr_collection_members").get(),
	).toEqual({ n: 0 });
	expect(
		(
			await request(`/${c.id}/members`, "PUT", {
				revision: 1,
				action: "add",
				pullIds: [pull.id, pull.id],
			})
		).status,
	).toBe(200);
	sqlite.raw
		.query(
			"UPDATE pull_requests SET state='merged',snapshot=json_set(snapshot,'$.state','merged') WHERE id=?",
		)
		.run(pull.id);
	const fresh = prCollectionSchema.parse(
		await (await request(`/${c.id}`)).json(),
	);
	expect(fresh.counts.merged).toBe(1);
	expect(fresh.counts.total).toBe(1);
	expect(
		(
			await request(`/${c.id}/members`, "PUT", {
				revision: 2,
				action: "add",
				pullIds: [pull.id],
			})
		).status,
	).toBe(200);
	expect(
		sqlite.raw.query("SELECT COUNT(*) n FROM pr_collection_members").get(),
	).toEqual({ n: 1 });
});

test("membership changes invalidate cursors and reads honor collection scope", async () => {
	const first = seedPull(sqlite);
	const second = seedPull(sqlite, { id: "second", externalId: "2", number: 2 });
	const collection = await create();
	await request(`/${collection.id}/members`, "PUT", {
		revision: 1,
		action: "add",
		pullIds: [first.id, second.id],
	});
	const query = `http://localhost/api/query/v1/prs?source=live&collectionId=${collection.id}&state=all&draft=include&limit=1`;
	const readQuery = (url: string) =>
		app.request(url, { headers: { host: "localhost" } }, { DB: sqlite.db });
	const initial = await readQuery(query);
	const page = (await initial.json()) as { page: { nextCursor: string } };
	expect(page.page.nextCursor).toBeTruthy();
	const continuation = `${query}&cursor=${encodeURIComponent(page.page.nextCursor)}`;
	expect((await readQuery(continuation)).status).toBe(200);
	await request(`/${collection.id}/members`, "PUT", {
		revision: 2,
		action: "remove",
		pullIds: [first.id],
	});
	expect((await readQuery(continuation)).status).toBe(409);
	const sample = await readQuery(query.replace("source=live", "source=sample"));
	expect(
		((await sample.json()) as { page: { total: number } }).page.total,
	).toBe(0);
	const unauthorized = await app.request(
		"https://signoff.hexly.ai/api/pr-collections",
		{
			method: "POST",
			headers: { host: "signoff.hexly.ai", "content-type": "application/json" },
			body: JSON.stringify(draft),
		},
		{
			DB: sqlite.db,
			CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
			CF_ACCESS_AUD: "test-audience",
		},
	);
	expect(unauthorized.status).toBe(401);
});
