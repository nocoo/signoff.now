import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type DirectoryData, identityKey } from "@signoff/domain/insights";
import app from "../index";
import { PR_TEST_NOW, seedProject, seedPull } from "../test/pr-fixture";
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

describe("persistent contributor blocks", () => {
	test("blocks exact accounts, isolates sources, and requires current directory revisions", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		seedProject(sqlite, {
			id: "sample-project",
			projectKey: "Sample",
			source: "demo",
		});
		seedPull(sqlite, { id: "sample-pull", projectId: "sample-project" });
		const key = `identity:${identityKey("ado", "test-org", "actor-1")}`;
		const initial = await directory();
		expect(
			(await request("/blocks", "POST", { key, blocked: true }, true, null))
				.status,
		).toBe(428);
		const response = await request("/blocks", "POST", { key, blocked: true });
		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			blockedContributorKeys: string[];
			revision: number;
		};
		expect(result.blockedContributorKeys).toEqual([key]);
		expect(result.revision).toBeGreaterThan(initial.revision);
		expect((await directory("demo")).blockedContributorKeys).toEqual([]);
		expect(
			(
				await request(
					"/blocks",
					"POST",
					{ key, blocked: false },
					true,
					initial.revision,
				)
			).status,
		).toBe(409);
		expect((await directory()).blockedContributorKeys).toEqual([key]);
		expect(
			(
				await request(
					"/blocks?source=demo",
					"POST",
					{ key, blocked: true },
					false,
				)
			).status,
		).toBe(403);
		expect(
			(
				await request("/blocks", "POST", {
					key: "identity:guessed-name",
					blocked: true,
				})
			).status,
		).toBe(400);
		expect(
			(
				await request("/blocks", "POST", {
					key: "member:missing",
					blocked: true,
				})
			).status,
		).toBe(404);
		expect(
			(await request("/blocks", "POST", { key, blocked: false })).status,
		).toBe(200);
		expect((await directory()).blockedContributorKeys).toEqual([]);
	});

	test("a concurrent edit rolls back the entire block mutation", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		const key = `identity:${identityKey("ado", "test-org", "actor-1")}`;
		sqlite.beforeBatch("INSERT OR IGNORE INTO contributor_blocks", () => {
			sqlite.raw.exec(
				"UPDATE directory_revisions SET revision = revision + 1 WHERE source = 'cli'",
			);
		});
		expect(
			(await request("/blocks", "POST", { key, blocked: true })).status,
		).toBe(409);
		expect((await directory()).blockedContributorKeys).toEqual([]);
	});

	test("links blocked accounts as a blocked group and preserves blocks across archive, unlink, and restore", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		seedPull(sqlite, {
			id: "second",
			externalId: "2",
			number: 2,
			author: { id: "actor-2", name: "Another account" },
		});
		const first = identityKey("ado", "test-org", "actor-1");
		const second = identityKey("ado", "test-org", "actor-2");
		await request("/blocks", "POST", {
			key: `identity:${first}`,
			blocked: true,
		});
		const person = await create("members", {
			name: "Bot",
			identityKeys: [first, second],
		});
		let data = await directory();
		expect(data.blockedContributorKeys).toEqual(
			[`identity:${first}`, `identity:${second}`, `member:${person.id}`].sort(),
		);
		await request(`/members/${person.id}/archive`, "POST");
		expect((await directory()).blockedContributorKeys).toEqual(
			data.blockedContributorKeys,
		);
		await request(`/members/${person.id}/restore`, "POST");
		await request(`/members/${person.id}`, "PUT", {
			name: "Bot",
			identityKeys: [first],
		});
		data = await directory();
		expect(data.blockedContributorKeys).toContain(`identity:${second}`);
		expect(data.members[0]?.archivedAt).toBeNull();
		await request("/blocks", "POST", {
			key: `identity:${first}`,
			blocked: false,
		});
		expect((await directory()).blockedContributorKeys).toEqual([
			`identity:${second}`,
		]);
		await request(`/members/${person.id}`, "PUT", {
			name: "Bot",
			identityKeys: [first, second],
		});
		expect((await directory()).blockedContributorKeys).toContain(
			`member:${person.id}`,
		);
		await request("/blocks", "POST", {
			key: `member:${person.id}`,
			blocked: false,
		});
		expect((await directory()).blockedContributorKeys).toEqual([]);
		expect((await directory()).members[0]?.identityKeys).toEqual([
			first,
			second,
		]);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS count FROM pull_requests").get(),
		).toEqual({ count: 2 });
	});

	test("blocks members without accounts and carries their block onto newly linked identities", async () => {
		seedProject(sqlite);
		seedPull(sqlite);
		const person = await create("members", { name: "No account yet" });
		const key = `member:${person.id}`;
		await request("/blocks", "POST", { key, blocked: true });
		expect((await directory()).blockedContributorKeys).toEqual([key]);
		const account = identityKey("ado", "test-org", "actor-1");
		await request(`/members/${person.id}`, "PUT", {
			name: "Linked now",
			identityKeys: [account],
		});
		expect((await directory()).blockedContributorKeys).toEqual(
			[`identity:${account}`, key].sort(),
		);
	});
});

describe("indexed directory metadata", () => {
	test("uses indexed account and repository probes before hydrating latest snapshots", async () => {
		seedProject(sqlite);
		for (let number = 1; number <= 30; number++)
			seedPull(sqlite, {
				id: `pr-${number}`,
				externalId: String(number),
				number,
				observedAt: PR_TEST_NOW + number,
			});
		const plans = new Map<string, string>();
		const prepare = sqlite.db.prepare.bind(sqlite.db);
		sqlite.db.prepare = (sql) => {
			const statement = prepare(sql);
			const bind = statement.bind.bind(statement);
			statement.bind = (...values) => {
				if (
					sql.includes("FROM accounts a") ||
					sql.includes("FROM repositories r")
				)
					plans.set(
						sql.includes("FROM accounts a") ? "authors" : "repositories",
						JSON.stringify(
							sqlite.raw
								.query(`EXPLAIN QUERY PLAN ${sql}`)
								.all(...(values as never[])),
						),
					);
				return bind(...values);
			};
			return statement;
		};
		const data = await directory();
		expect(data.identities).toHaveLength(1);
		expect(data.identities[0]?.lastSeenAt).toBe(PR_TEST_NOW + 30);
		expect(plans.get("authors")).toContain("pull_requests_author_observation");
		expect(plans.get("authors")).toContain(
			"SEARCH latest USING COVERING INDEX pull_requests_author_observation",
		);
		expect(plans.get("authors")).toContain(
			"SEARCH pr USING INDEX sqlite_autoindex_pull_requests_1 (id=?)",
		);
		expect(plans.get("repositories")).toContain(
			"SEARCH latest USING COVERING INDEX pull_requests_repository_observation",
		);
		expect(plans.get("repositories")).toContain(
			"SEARCH pr USING INDEX sqlite_autoindex_pull_requests_1 (id=?)",
		);
	});

	test("combines the same organization account across projects while preserving provider, actor casing, and source boundaries", async () => {
		seedProject(sqlite);
		seedPull(sqlite, {
			author: {
				id: "actor-1",
				name: "Old",
				avatarUrl: "https://example.com/old.png",
			},
			repository: { id: "repo-1", name: "Old repo" },
		});
		seedProject(sqlite, {
			id: "second-project",
			organization: "TEST-ORG",
			projectKey: "Other",
		});
		seedPull(sqlite, {
			id: "second-pr",
			projectId: "second-project",
			observedAt: PR_TEST_NOW + 10,
			author: {
				id: "actor-1",
				name: "Latest",
				avatarUrl: "https://example.com/latest.png",
			},
		});
		seedPull(sqlite, {
			id: "repo-rename",
			externalId: "3",
			number: 3,
			observedAt: PR_TEST_NOW + 5,
			author: { id: "ACTOR-1", name: "Different casing" },
			repository: { id: "repo-1", name: "New repo" },
		});
		seedProject(sqlite, { id: "github-project", provider: "github" });
		seedPull(sqlite, {
			id: "github-pr",
			projectId: "github-project",
			author: { id: "actor-1", name: "GitHub account" },
		});
		seedProject(sqlite, {
			id: "sample-project",
			source: "demo",
			projectKey: "Sample",
		});
		seedPull(sqlite, {
			id: "sample-pr",
			projectId: "sample-project",
			observedAt: PR_TEST_NOW + 100,
			author: { id: "actor-1", name: "Sample account" },
		});
		seedPull(sqlite, {
			id: "unknown-pr",
			externalId: "4",
			number: 4,
			author: { id: "unknown", name: "Unknown" },
		});
		const data = await directory();
		expect(data.identities).toHaveLength(3);
		expect(
			data.identities.find(
				(identity) =>
					identity.key === identityKey("ado", "test-org", "actor-1"),
			),
		).toMatchObject({
			name: "Latest",
			avatarUrl: "https://example.com/latest.png",
			lastSeenAt: PR_TEST_NOW + 10,
		});
		expect(
			data.identities.find(
				(identity) =>
					identity.key === identityKey("ado", "test-org", "ACTOR-1"),
			)?.name,
		).toBe("Different casing");
		expect(
			data.identities.find((identity) => identity.provider === "github")?.name,
		).toBe("GitHub account");
		expect(
			data.repositories.find(
				(repository) => repository.projectId === "live-project",
			)?.name,
		).toBe("New repo");
		expect((await directory("demo")).identities[0]?.name).toBe(
			"Sample account",
		);
	});

	test("uses the latest linked avatar only when the member has no explicit avatar", async () => {
		seedProject(sqlite);
		seedPull(sqlite, {
			author: {
				id: "actor-1",
				name: "First account",
				avatarUrl: "https://example.com/first.png",
			},
		});
		seedPull(sqlite, {
			id: "second-pr",
			externalId: "2",
			number: 2,
			observedAt: PR_TEST_NOW + 1,
			author: {
				id: "actor-2",
				name: "Second account",
				avatarUrl: "https://example.com/second.png",
			},
		});
		const identityKeys = [
			identityKey("ado", "test-org", "actor-1"),
			identityKey("ado", "test-org", "actor-2"),
		];
		const member = await create("members", {
			name: "Preferred name",
			identityKeys,
		});
		expect((await directory()).members[0]).toMatchObject({
			name: "Preferred name",
			avatarUrl: "https://example.com/second.png",
		});
		await request(`/members/${member.id}`, "PUT", {
			name: "Preferred name",
			identityKeys,
			avatarUrl: "https://example.com/override.png",
		});
		expect((await directory()).members[0]?.avatarUrl).toBe(
			"https://example.com/override.png",
		);
		await request(`/members/${member.id}`, "PUT", {
			name: "Preferred name",
			identityKeys,
			avatarUrl: null,
		});
		sqlite.raw
			.query(
				"UPDATE developer_identities SET last_seen_at = ?, avatar_url = ? WHERE source = 'cli' AND identity_key = ?",
			)
			.run(
				PR_TEST_NOW + 10,
				"https://example.com/retained.png",
				identityKeys[0] as string,
			);
		expect((await directory()).members[0]?.avatarUrl).toBe(
			"https://example.com/retained.png",
		);
		sqlite.raw.exec("DELETE FROM pull_requests");
		expect((await directory()).members[0]?.avatarUrl).toBe(
			"https://example.com/retained.png",
		);
	});
});
