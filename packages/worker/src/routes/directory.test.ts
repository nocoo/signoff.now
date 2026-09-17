import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type DirectoryData, identityKey } from "@signoff/domain/insights";
import app from "../index";
import { seedProject, seedPull } from "../test/pr-fixture";
import {
	createConcurrentSqliteD1,
	createSqliteD1,
	type SqliteD1,
} from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
const request = (
	path: string,
	method = "GET",
	body?: unknown,
	demoMode = true,
	expectedRevision?: number | string | null,
) => {
	const source =
		new URL(`http://localhost/${path}`).searchParams.get("source") ?? "cli";
	const revision =
		expectedRevision === undefined
			? ((
					sqlite.raw
						.query("SELECT revision FROM directory_revisions WHERE source = ?")
						.get(source) as { revision: number } | null
				)?.revision ?? 0)
			: expectedRevision;
	return app.request(
		`http://localhost/api/directory${path}`,
		{
			method,
			headers: {
				host: "localhost",
				"content-type": "application/json",
				...(revision === null
					? {}
					: {
							"if-match":
								typeof revision === "number" ? `"${revision}"` : revision,
						}),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_DEMO_MODE: demoMode ? "1" : "0" },
	);
};
const directory = async (source = "cli") =>
	(await (await request(`?source=${source}`)).json()) as DirectoryData;
const create = async (kind: string, body: unknown, source = "cli") => {
	const response = await request(`/${kind}?source=${source}`, "POST", body);
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string };
};

describe("followed PR contributors and memberships", () => {
	test("renaming active entries preserves every hidden relationship to archived targets", async () => {
		const tag = await create("tags", { name: "Core", color: "#112233" });
		const team = await create("teams", { name: "Platform", tagIds: [tag.id] });
		const member = await create("members", {
			name: "Alice",
			teamIds: [team.id],
			tagIds: [tag.id],
		});
		await request(`/members/${member.id}/archive`, "POST");
		let data = await directory();
		expect(data.teams[0]?.memberIds).toEqual([]);
		expect(
			(
				await request(`/teams/${team.id}`, "PUT", {
					name: "Renamed platform",
					memberIds: data.teams[0]?.memberIds,
					tagIds: data.teams[0]?.tagIds,
				})
			).status,
		).toBe(200);
		await request(`/members/${member.id}/restore`, "POST");
		expect((await directory()).members[0]?.teamIds).toEqual([team.id]);

		await request(`/teams/${team.id}/archive`, "POST");
		data = await directory();
		expect(data.members[0]?.teamIds).toEqual([]);
		expect(
			(
				await request(`/members/${member.id}`, "PUT", {
					name: "Alice renamed",
					teamIds: data.members[0]?.teamIds,
					tagIds: data.members[0]?.tagIds,
				})
			).status,
		).toBe(200);
		await request(`/teams/${team.id}/restore`, "POST");
		expect((await directory()).teams[0]?.memberIds).toEqual([member.id]);

		await request(`/tags/${tag.id}/archive`, "POST");
		data = await directory();
		expect(data.members[0]?.tagIds).toEqual([]);
		expect(data.teams[0]?.tagIds).toEqual([]);
		await request(`/members/${member.id}`, "PUT", {
			name: "Alice",
			teamIds: [team.id],
			tagIds: [],
		});
		await request(`/teams/${team.id}`, "PUT", {
			name: "Platform",
			memberIds: [member.id],
			tagIds: [],
		});
		await request(`/tags/${tag.id}/restore`, "POST");
		data = await directory();
		expect(data.members[0]?.tagIds).toEqual([tag.id]);
		expect(data.teams[0]?.tagIds).toEqual([tag.id]);
	});

	test("two independent editors cannot both overwrite the same loaded directory", async () => {
		const concurrent = createConcurrentSqliteD1(2);
		try {
			concurrent.raw
				.query(
					"INSERT INTO developers (id, name, alias, avatar_url) VALUES ('alice', 'Alice', 'alice', 'https://example.com/old.png')",
				)
				.run();
			const { revision } = concurrent.raw
				.query("SELECT revision FROM directory_revisions WHERE source = 'cli'")
				.get() as { revision: number };
			concurrent.barrierBeforeBatch("UPDATE developers SET name", 2);
			const drafts = [
				{ name: "Alice renamed", avatarUrl: "https://example.com/old.png" },
				{ name: "Alice", avatarUrl: "https://example.com/new.png" },
			];
			const responses = await Promise.all(
				concurrent.connections.map((db, index) =>
					app.request(
						"http://localhost/api/directory/members/alice",
						{
							method: "PUT",
							headers: {
								host: "localhost",
								"content-type": "application/json",
								"if-match": `"${revision}"`,
							},
							body: JSON.stringify(drafts[index]),
						},
						{ DB: db },
					),
				),
			);
			expect(concurrent.barrierArrivals()).toBe(2);
			expect(responses.map((response) => response.status).sort()).toEqual([
				200, 409,
			]);
			const winner = responses.findIndex((response) => response.status === 200);
			expect(
				concurrent.raw
					.query(
						"SELECT name, avatar_url AS avatarUrl FROM developers WHERE id = 'alice'",
					)
					.get(),
			).toEqual(drafts[winner]);
		} finally {
			concurrent.close();
		}
	});

	test("inverse membership and legacy edits invalidate stale forms and roll back the whole losing batch", async () => {
		const team = await create("teams", { name: "Platform" });
		const member = await create("members", { name: "Alice" });
		const loaded = await directory();
		await request(`/teams/${team.id}`, "PUT", {
			name: "Platform",
			memberIds: [member.id],
		});
		const version = sqlite.raw
			.query("SELECT value FROM settings WHERE key = 'pipeline_config_version'")
			.get();
		const conflict = await request(
			`/members/${member.id}`,
			"PUT",
			{ name: "Stale", teamIds: [] },
			true,
			loaded.revision,
		);
		expect(conflict.status).toBe(409);
		expect((await directory()).members[0]).toMatchObject({
			name: "Alice",
			teamIds: [team.id],
		});
		expect(
			sqlite.raw
				.query(
					"SELECT value FROM settings WHERE key = 'pipeline_config_version'",
				)
				.get(),
		).toEqual(version);

		const fresh = await directory();
		const legacy = await app.request(
			`http://localhost/api/developers/${member.id}`,
			{
				method: "PATCH",
				headers: { host: "localhost", "content-type": "application/json" },
				body: JSON.stringify({ name: "Legacy rename" }),
			},
			{ DB: sqlite.db },
		);
		expect(legacy.status).toBe(200);
		expect(
			(
				await request(
					`/members/${member.id}/archive`,
					"POST",
					undefined,
					true,
					fresh.revision,
				)
			).status,
		).toBe(409);
		expect(
			(
				await request(
					`/members/${member.id}`,
					"PUT",
					{ name: "Stale" },
					true,
					fresh.revision,
				)
			).status,
		).toBe(409);
		expect((await directory()).members[0]).toMatchObject({
			name: "Legacy rename",
			archivedAt: null,
			teamIds: [team.id],
		});
	});

	test("requires a loaded revision for every mutation and keeps Live and Sample revisions independent", async () => {
		const loaded = await directory();
		expect(loaded.revision).toBe(0);
		for (const revision of [null, "0", 'W/"0"', '"9007199254740992"']) {
			expect(
				(await request("/members", "POST", { name: "Alice" }, true, revision))
					.status,
			).toBe(428);
		}
		await create("tags", { name: "Sample", color: "#112233" }, "demo");
		expect((await directory()).revision).toBe(loaded.revision);
		expect((await directory("demo")).revision).toBeGreaterThan(0);
		expect(
			(
				await request(
					"/members",
					"POST",
					{ name: "Alice" },
					true,
					loaded.revision,
				)
			).status,
		).toBe(201);
		const member = (await directory()).members[0];
		expect(
			(
				await request(
					`/members/${member?.id}/archive`,
					"POST",
					undefined,
					true,
					null,
				)
			).status,
		).toBe(428);
	});
	test("a concurrent account claim rolls back the losing member and all of its links", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		const key = identityKey("ado", "test-org", "actor-1");
		const team = await create("teams", { name: "Platform" });
		sqlite.beforeBatch("INSERT INTO developers", () => {
			sqlite.raw
				.query(
					"INSERT INTO developers (id, name, alias) VALUES ('winner', 'Winner', 'winner')",
				)
				.run();
			sqlite.raw
				.query(
					"INSERT INTO developer_identities (source, identity_key, provider, organization, actor_id, developer_id, name) VALUES ('cli', ?, 'ado', 'test-org', 'actor-1', 'winner', 'Alice')",
				)
				.run(key);
		});
		expect(
			(
				await request("/members?source=cli", "POST", {
					name: "Loser",
					identityKeys: [key],
					teamIds: [team.id],
				})
			).status,
		).toBe(409);
		const data = await directory();
		expect(data.members.map((member) => member.id)).toEqual(["winner"]);
		expect(data.teams[0]?.memberIds).toEqual([]);
		expect(data.identities[0]?.memberId).toBe("winner");
	});

	test("archiving the owner before save cannot clear affiliations or bump pipeline settings", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		const team = await create("teams", { name: "Platform" });
		const key = identityKey("ado", "test-org", "actor-1");
		const member = await create("members", {
			name: "Alice",
			identityKeys: [key],
			teamIds: [team.id],
		});
		const before = sqlite.raw
			.query("SELECT value FROM settings WHERE key = 'pipeline_config_version'")
			.get();
		sqlite.beforeBatch("UPDATE developers SET name", () => {
			sqlite.raw
				.query("UPDATE developers SET archived_at = unixepoch() WHERE id = ?")
				.run(member.id);
		});
		expect(
			(
				await request(`/members/${member.id}?source=cli`, "PUT", {
					name: "Changed",
					teamIds: [],
					identityKeys: [],
				})
			).status,
		).toBe(409);
		expect((await directory()).members[0]).toMatchObject({
			name: "Alice",
			teamIds: [team.id],
			identityKeys: [key],
		});
		expect(
			sqlite.raw
				.query(
					"SELECT value FROM settings WHERE key = 'pipeline_config_version'",
				)
				.get(),
		).toEqual(before);
	});

	test("edits tag colors, rejects restore conflicts, and restricts Sample archiving to local demo mode", async () => {
		const tag = await create(
			"tags",
			{ name: "Core", color: "#112233" },
			"demo",
		);
		expect(
			(
				await request(`/tags/${tag.id}?source=demo`, "PUT", {
					name: "Core",
					color: "#aabbcc",
				})
			).status,
		).toBe(200);
		expect((await directory("demo")).tags[0]?.color).toBe("#AABBCC");
		expect(
			(
				await request(
					`/tags/${tag.id}/archive?source=demo`,
					"POST",
					undefined,
					false,
				)
			).status,
		).toBe(403);
		expect(
			(await request(`/tags/${tag.id}/archive?source=demo`, "POST")).status,
		).toBe(200);
		await create("tags", { name: "Core", color: "#334455" }, "demo");
		expect(
			(await request(`/tags/${tag.id}/restore?source=demo`, "POST")).status,
		).toBe(409);
		expect(
			(await directory("demo")).tags.find((row) => row.id === tag.id)
				?.archivedAt,
		).toBeNumber();
	});
	test("reuses existing roster rows, while Live and Sample catalogues remain separate", async () => {
		sqlite.raw
			.query(
				"INSERT INTO developers (id, name, alias) VALUES ('existing', 'Existing person', 'existing')",
			)
			.run();
		seedProject(sqlite);
		seedProject(sqlite, {
			id: "sample-project",
			source: "demo",
			organization: "sample-org",
		});
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "sample-pull",
			projectId: "sample-project",
			author: { id: "actor-1", name: "Sample person" },
		});
		const live = await directory();
		expect(live.members.map((member) => member.id)).toEqual(["existing"]);
		expect(live.identities).toHaveLength(1);
		expect(live.identities[0]).toMatchObject({
			name: "Alice",
			key: identityKey("ado", "test-org", "actor-1"),
			memberId: null,
		});
		expect(live.repositories).toHaveLength(1);
		expect(live.projects.map((project) => project.id)).toEqual([
			"live-project",
		]);
		const sample = await directory("demo");
		expect(sample.members).toEqual([]);
		expect(sample.identities[0]?.name).toBe("Sample person");
	});

	test("one person can own explicit accounts in multiple orgs, never steal another person's identity", async () => {
		seedProject(sqlite);
		seedProject(sqlite, { id: "other", organization: "other-org" });
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "other-pull",
			projectId: "other",
			author: { id: "actor-2", name: "Alice elsewhere" },
		});
		const team = await create("teams", { name: "Platform" });
		const tag = await create("tags", { name: "Maintainers", color: "#ab12ef" });
		const keys = [
			identityKey("ado", "test-org", "actor-1"),
			identityKey("ado", "other-org", "actor-2"),
		];
		const member = await create("members", {
			name: "Alice",
			identityKeys: keys,
			teamIds: [team.id],
			tagIds: [tag.id],
		});
		const data = await directory();
		expect(data.members[0]).toMatchObject({
			id: member.id,
			teamIds: [team.id],
			tagIds: [tag.id],
			identityKeys: [...keys].sort(),
		});
		expect(data.teams[0]?.memberIds).toEqual([member.id]);
		expect(
			data.identities.every((identity) => identity.memberId === member.id),
		).toBe(true);
		expect(
			(
				await request("/members?source=cli", "POST", {
					name: "Imposter",
					identityKeys: [keys[0]],
				})
			).status,
		).toBe(409);
		expect((await directory()).members).toHaveLength(1);
	});

	test("editing memberships from either side is atomic, supports clearing, and rejects cross-source targets", async () => {
		const liveTeam = await create("teams", { name: "Shared name" });
		const demoTeam = await create("teams", { name: "Shared name" }, "demo");
		const member = await create("members", {
			name: "Alice",
			teamIds: [liveTeam.id],
		});
		expect(
			(
				await request(`/members/${member.id}?source=cli`, "PUT", {
					name: "Wrong",
					teamIds: [demoTeam.id],
				})
			).status,
		).toBe(400);
		expect((await directory()).members[0]?.name).toBe("Alice");
		expect(
			(
				await request(`/teams/${liveTeam.id}?source=cli`, "PUT", {
					name: "Updated",
					memberIds: [],
				})
			).status,
		).toBe(200);
		expect((await directory()).members[0]?.teamIds).toEqual([]);
		expect(
			(
				await request(`/teams/${liveTeam.id}?source=cli`, "PUT", {
					name: "Updated",
					memberIds: [member.id],
				})
			).status,
		).toBe(200);
		expect((await directory()).members[0]?.teamIds).toEqual([liveTeam.id]);
		expect(
			(
				await request(`/members/${member.id}?source=demo`, "PUT", {
					name: "Changed",
				})
			).status,
		).toBe(404);
	});

	test("archive and restore retain identities, hide inactive memberships, and leave another source alone", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		const team = await create("teams", { name: "Platform" });
		const member = await create("members", {
			name: "Alice",
			identityKeys: [identityKey("ado", "test-org", "actor-1")],
			teamIds: [team.id],
		});
		expect(
			(await request(`/members/${member.id}/archive?source=demo`, "POST"))
				.status,
		).toBe(404);
		expect(
			(await request(`/members/${member.id}/archive?source=cli`, "POST"))
				.status,
		).toBe(200);
		expect((await directory()).members[0]?.archivedAt).toBeNumber();
		expect((await directory()).teams[0]?.memberIds).toEqual([]);
		expect(
			(
				await request(`/members/${member.id}?source=cli`, "PUT", {
					name: "Bad",
				})
			).status,
		).toBe(404);
		expect(
			(await request(`/members/${member.id}/restore?source=cli`, "POST"))
				.status,
		).toBe(200);
		expect((await directory()).teams[0]?.memberIds).toEqual([member.id]);
		expect((await directory()).members[0]?.identityKeys).toHaveLength(1);
	});

	test("matches exact provider IDs, keeps linked identities after PRs disappear, and excludes unknown authors", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "pull-2",
			number: 2,
			externalId: "2",
			author: { id: "actor-2", name: "Alice" },
		});
		seedPull(sqlite, {
			id: "pull-3",
			number: 3,
			externalId: "3",
			author: { id: "unknown", name: "Unknown" },
		});
		const key = identityKey("ado", "test-org", "actor-1");
		const member = await create("members", {
			name: "Alice",
			identityKeys: [key],
		});
		expect((await directory()).identities).toHaveLength(2);
		expect(
			(await directory()).identities.find(
				(identity) => identity.actorId === "actor-2",
			)?.memberId,
		).toBeNull();
		sqlite.raw.query("DELETE FROM pull_requests").run();
		expect((await directory()).identities[0]).toMatchObject({
			key,
			memberId: member.id,
		});
	});

	test("rejects invented identities, unsafe avatars, invalid bodies, and production Sample writes", async () => {
		for (const body of [
			null,
			[],
			{},
			{ name: "Alice", identityKeys: [identityKey("ado", "org", "invented")] },
			{ name: "Alice", avatarUrl: "javascript:alert(1)" },
			{ name: "Alice", avatarUrl: "https://user:secret@example.com/pic" },
		]) {
			expect((await request("/members?source=cli", "POST", body)).status).toBe(
				400,
			);
		}
		expect((await request("?source=wrong")).status).toBe(400);
		expect(
			(await request("/members?source=demo", "POST", { name: "Sample" }, false))
				.status,
		).toBe(403);
		expect((await request("/anything?source=cli", "POST", {})).status).toBe(
			404,
		);
	});
});
