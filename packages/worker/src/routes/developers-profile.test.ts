/**
 * Avatar URLs and team membership, driven against real SQLite.
 *
 * The mock D1 in `developers.test.ts` answers by SQL substring, which cannot
 * model a JOIN or a composite primary key — exactly the parts that decide
 * whether memberships are written correctly. These run the real migrations.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1.ts";
import type { AppEnv } from "../types.js";
import {
	developersCreateRoute,
	developersListRoute,
	developersPatchRoute,
} from "./developers.js";
import { teamsCreateRoute, teamsListRoute, teamsPatchRoute } from "./teams.js";

let sqlite: SqliteD1;

function mount() {
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.env = { DB: sqlite.db } as AppEnv["Bindings"];
		return next();
	});
	app.get("/api/developers", developersListRoute);
	app.post("/api/developers", developersCreateRoute);
	app.patch("/api/developers/:id", developersPatchRoute);
	app.get("/api/teams", teamsListRoute);
	app.post("/api/teams", teamsCreateRoute);
	app.patch("/api/teams/:id", teamsPatchRoute);
	return app;
}

async function post(body: unknown): Promise<Response> {
	return await mount().request("http://x/api/developers", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Create, then hand back the parsed body every membership test needs. */
async function created(body: unknown): Promise<{ id: string }> {
	return (await (await post(body)).json()) as { id: string };
}

async function patch(id: string, body: unknown): Promise<Response> {
	return await mount().request(`http://x/api/developers/${id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function seedTag(id: string, name: string, archived = false) {
	sqlite.raw
		.query(
			`INSERT INTO tags (id, name, color, created_at, updated_at, archived_at)
       VALUES (?, ?, '#FFFFFF', unixepoch(), unixepoch(), ?)`,
		)
		.run(id, name, archived ? 1 : null);
}

function seedTeam(id: string, name: string, archived = false) {
	sqlite.raw
		.query(
			`INSERT INTO teams (id, name, created_at, updated_at, archived_at)
       VALUES (?, ?, unixepoch(), unixepoch(), ?)`,
		)
		.run(id, name, archived ? 1 : null);
}

const version = () =>
	(
		sqlite.raw
			.query<{ v: string }, []>(
				"SELECT value AS v FROM settings WHERE key = 'pipeline_config_version'",
			)
			.get() as { v: string }
	).v;

beforeEach(() => {
	sqlite = createSqliteD1();
	seedTeam("t-alpha", "Alpha");
	seedTeam("t-beta", "Beta");
	seedTag("g-fe", "frontend");
	seedTag("g-be", "backend");
});

describe("avatar urls", () => {
	test("a create stores and returns the url", async () => {
		const res = await post({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ avatarUrl: "https://x/a.png" });
	});

	test("a script-bearing url is refused, not stored", async () => {
		// This value lands in an `<img src>` seen by every viewer.
		const res = await post({
			name: "Ada",
			alias: "ada",
			avatarUrl: "javascript:alert(1)",
		});
		expect(res.status).toBe(400);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM developers").get(),
		).toMatchObject({ n: 0 });
	});

	test("omitting avatarUrl on PATCH keeps the existing one", async () => {
		// Otherwise every rename would silently clear the picture.
		const dev = await created({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
		});
		const res = await patch(dev.id, { name: "Ada L" });
		expect(await res.json()).toMatchObject({
			name: "Ada L",
			avatarUrl: "https://x/a.png",
		});
	});

	test("an explicit null clears it", async () => {
		const dev = await created({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
		});
		const res = await patch(dev.id, { avatarUrl: null });
		expect(await res.json()).toMatchObject({ avatarUrl: null });
	});
});

describe("team membership", () => {
	test("a create writes the memberships and echoes them back", async () => {
		const res = await post({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha", "t-beta"],
		});
		expect(res.status).toBe(201);
		// Ordered by team name, so the UI renders a stable list.
		expect(await res.json()).toMatchObject({ teamIds: ["t-alpha", "t-beta"] });
	});

	test("a duplicate id is not an error", async () => {
		// A repeated selection in the UI would otherwise hit the composite
		// primary key and roll the whole batch back — a 500 for a harmless click.
		const res = await post({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha", "t-alpha"],
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ teamIds: ["t-alpha"] });
	});

	test("an id naming no live team is skipped, not fatal", async () => {
		seedTeam("t-gone", "Gone", true);
		const res = await post({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha", "t-gone", "t-missing"],
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ teamIds: ["t-alpha"] });
	});

	test("omitting teamIds on PATCH leaves memberships alone", async () => {
		const dev = await created({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha"],
		});
		const res = await patch(dev.id, { name: "Ada L" });
		expect(await res.json()).toMatchObject({ teamIds: ["t-alpha"] });
	});

	test("an empty array removes them all", async () => {
		// Distinct from omitting the field: the caller must be able to say
		// "no teams" as well as "do not touch teams".
		const dev = await created({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha", "t-beta"],
		});
		const res = await patch(dev.id, { teamIds: [] });
		expect(await res.json()).toMatchObject({ teamIds: [] });
	});

	test("the list route reports each developer's teams", async () => {
		await post({ name: "Ada", alias: "ada", teamIds: ["t-beta"] });
		await post({ name: "Bob", alias: "bob" });
		const body = (await (
			await mount().request("http://x/api/developers")
		).json()) as {
			items: { alias: string; teamIds: string[] }[];
		};
		const by = new Map(body.items.map((i) => [i.alias, i.teamIds]));
		expect(by.get("ada")).toEqual(["t-beta"]);
		expect(by.get("bob")).toEqual([]);
	});

	test("a bad teamIds payload is a 400", async () => {
		expect(
			(await post({ name: "A", alias: "a", teamIds: "t-alpha" })).status,
		).toBe(400);
		expect((await post({ name: "B", alias: "b", teamIds: [""] })).status).toBe(
			400,
		);
	});
});

describe("what does and does not force a rematch", () => {
	test("changing the alias bumps the config version", async () => {
		const dev = await created({ name: "Ada", alias: "ada" });
		const before = version();
		await patch(dev.id, { alias: "ada2" });
		expect(version()).not.toBe(before);
	});

	test("changing only the avatar or teams does NOT", async () => {
		// The alias moves the identity match set, so every historical score has
		// to be recomputed. A picture or a team reshuffle changes nothing about
		// who owns which activity — bumping for those would force a full
		// rematch over cosmetics.
		const dev = await created({ name: "Ada", alias: "ada" });
		const before = version();
		await patch(dev.id, { avatarUrl: "https://x/a.png" });
		await patch(dev.id, { teamIds: ["t-alpha"] });
		await patch(dev.id, { name: "Ada Lovelace" });
		expect(version()).toBe(before);
	});
});

describe("team avatars", () => {
	const postTeam = (body: unknown) =>
		mount().request("http://x/api/teams", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const patchTeam = (id: string, body: unknown) =>
		mount().request(`http://x/api/teams/${id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	test("a team keeps its avatar through an unrelated rename", async () => {
		// Same rule as developers: a PATCH that omits the field must not wipe it.
		const t = (await (
			await postTeam({ name: "Gamma", avatarUrl: "https://x/t.png" })
		).json()) as { id: string; avatarUrl: string };
		expect(t.avatarUrl).toBe("https://x/t.png");

		const res = await patchTeam(t.id, { name: "Gamma Team" });
		expect(await res.json()).toMatchObject({
			name: "Gamma Team",
			avatarUrl: "https://x/t.png",
		});
	});

	test("a team avatar can be cleared explicitly", async () => {
		const t = (await (
			await postTeam({ name: "Delta", avatarUrl: "https://x/t.png" })
		).json()) as { id: string };
		const res = await patchTeam(t.id, { name: "Delta", avatarUrl: null });
		expect(await res.json()).toMatchObject({ avatarUrl: null });
	});

	test("an avatar-only PATCH does not demand a name", async () => {
		// The developer route accepts any subset of fields; teams must too, or
		// "change just the picture" is a 400 on one entity and fine on the other.
		const t = (await (await postTeam({ name: "Zeta" })).json()) as {
			id: string;
		};
		const res = await patchTeam(t.id, { avatarUrl: "https://x/t.png" });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			name: "Zeta",
			avatarUrl: "https://x/t.png",
		});
	});

	test("a blank name is still refused", async () => {
		// Absent means "leave it"; present-but-empty is a mistake worth reporting.
		const t = (await (await postTeam({ name: "Eta" })).json()) as {
			id: string;
		};
		expect((await patchTeam(t.id, { name: "  " })).status).toBe(400);
	});

	test("a PATCH on a missing team is still 404, not 200", async () => {
		expect((await patchTeam("nope", { avatarUrl: null })).status).toBe(404);
	});

	test("a script-bearing team avatar is refused", async () => {
		expect(
			(await postTeam({ name: "Eps", avatarUrl: "javascript:alert(1)" }))
				.status,
		).toBe(400);
	});
});

describe("concurrent edits (Codex review, 2026-07-28)", () => {
	// These run sequentially, not via Promise.all: the SQLite test shim cannot
	// nest transactions, so overlapping batches throw "cannot start a
	// transaction within a transaction" — a harness limit, not a D1 behaviour.
	// Sequencing still exercises the real defect, because the bug was that each
	// PATCH wrote back scalars it had read BEFORE the other one landed.

	test("an alias PATCH does not clobber an avatar set just before it", async () => {
		// Both routes used to pre-read the row and write all three scalars back,
		// so the second one copied its stale copy of the other's field over the
		// fresh value — and both answered 200. Only the columns a request
		// actually named may be written.
		const dev = await created({ name: "Ada", alias: "ada" });
		expect((await patch(dev.id, { avatarUrl: "https://x/a.png" })).status).toBe(
			200,
		);
		expect((await patch(dev.id, { alias: "ada2" })).status).toBe(200);

		const row = sqlite.raw
			.query(
				"SELECT alias, avatar_url AS avatarUrl FROM developers WHERE id = ?",
			)
			.get(dev.id) as { alias: string; avatarUrl: string | null };
		expect(row).toEqual({ alias: "ada2", avatarUrl: "https://x/a.png" });
	});

	test("a teams PATCH does not clobber a name set just before it", async () => {
		const dev = await created({ name: "Ada", alias: "ada" });
		await patch(dev.id, { name: "Ada Lovelace" });
		await patch(dev.id, { teamIds: ["t-alpha"] });
		const res = await patch(dev.id, {});
		expect(await res.json()).toMatchObject({
			name: "Ada Lovelace",
			teamIds: ["t-alpha"],
		});
	});

	test("a PATCH on a row archived first commits NOTHING", async () => {
		// D1 rolls a batch back on error but NOT on a statement matching zero
		// rows. Without a guard on each dependent statement, the membership
		// write and the version bump both committed and the route then answered
		// 404 — a version bump nobody asked for, blocking the dashboard.
		const dev = await created({ name: "Ada", alias: "ada" });
		sqlite.raw
			.query("UPDATE developers SET archived_at = unixepoch() WHERE id = ?")
			.run(dev.id);
		const before = version();

		const res = await patch(dev.id, { alias: "ada2", teamIds: ["t-alpha"] });
		expect(res.status).toBe(404);

		expect(
			sqlite.raw
				.query(
					"SELECT COUNT(*) AS n FROM developer_teams WHERE developer_id = ?",
				)
				.get(dev.id),
		).toMatchObject({ n: 0 });
		expect(version()).toBe(before);
		expect(
			sqlite.raw.query("SELECT alias FROM developers WHERE id = ?").get(dev.id),
		).toMatchObject({ alias: "ada" });
	});

	test("an empty PATCH body changes nothing and does not bump", async () => {
		const dev = await created({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
			teamIds: ["t-alpha"],
		});
		const before = version();
		const res = await patch(dev.id, {});
		expect(await res.json()).toMatchObject({
			name: "Ada",
			alias: "ada",
			avatarUrl: "https://x/a.png",
			teamIds: ["t-alpha"],
		});
		expect(version()).toBe(before);
	});
});

describe("tags on developers", () => {
	test("a create stores and echoes tag ids", async () => {
		const res = await post({
			name: "Ada",
			alias: "ada",
			tagIds: ["g-be", "g-fe"],
		});
		expect(res.status).toBe(201);
		// Ordered by tag name, so the UI renders a stable list.
		expect(await res.json()).toMatchObject({ tagIds: ["g-be", "g-fe"] });
	});

	test("tags and teams are independent", async () => {
		// One list must not clear the other: they are separate join tables and
		// a PATCH naming only one has nothing to say about the other.
		const dev = await created({
			name: "Ada",
			alias: "ada",
			teamIds: ["t-alpha"],
			tagIds: ["g-fe"],
		});
		const res = await patch(dev.id, { tagIds: ["g-be"] });
		expect(await res.json()).toMatchObject({
			teamIds: ["t-alpha"],
			tagIds: ["g-be"],
		});
	});

	test("omitting tagIds on PATCH leaves them alone", async () => {
		const dev = await created({ name: "Ada", alias: "ada", tagIds: ["g-fe"] });
		const res = await patch(dev.id, { name: "Ada L" });
		expect(await res.json()).toMatchObject({ tagIds: ["g-fe"] });
	});

	test("an empty array removes them all", async () => {
		const dev = await created({ name: "Ada", alias: "ada", tagIds: ["g-fe"] });
		const res = await patch(dev.id, { tagIds: [] });
		expect(await res.json()).toMatchObject({ tagIds: [] });
	});

	test("an unknown tag id is skipped, not fatal", async () => {
		const res = await post({
			name: "Ada",
			alias: "ada",
			tagIds: ["g-fe", "g-missing"],
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ tagIds: ["g-fe"] });
	});

	test("an ARCHIVED tag is not attached", async () => {
		// Separate from the unknown-id case: an archived tag still EXISTS, so
		// only the `archived_at IS NULL` half of the guard rejects it. Folding
		// the two into one test let a mutation that drops that half survive —
		// the row would be written and then hidden by the read-side JOIN, so
		// the response looked identical while the table quietly filled up.
		seedTag("g-gone", "gone", true);
		const res = await post({ name: "Ada", alias: "ada", tagIds: ["g-gone"] });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ tagIds: [] });
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM developer_tags").get(),
		).toMatchObject({ n: 0 });
	});

	test("an ARCHIVED team is not attached either", async () => {
		seedTeam("t-gone2", "Gone", true);
		const res = await post({
			name: "Bob",
			alias: "bob",
			teamIds: ["t-gone2"],
		});
		expect(res.status).toBe(201);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM developer_teams").get(),
		).toMatchObject({ n: 0 });
	});

	test("a bad tagIds payload names the right field", async () => {
		// "teamIds must be an array" for a tagIds mistake would send the caller
		// to the wrong field.
		const res = await post({ name: "A", alias: "a", tagIds: "g-fe" });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: "tagIds must be an array",
		});
	});

	test("tagging does NOT bump the config version", async () => {
		// Tags are labels; they change nothing about who owns which activity.
		const dev = await created({ name: "Ada", alias: "ada" });
		const before = version();
		await patch(dev.id, { tagIds: ["g-fe"] });
		expect(version()).toBe(before);
	});

	test("the list route reports each developer's tags", async () => {
		await post({ name: "Ada", alias: "ada", tagIds: ["g-fe"] });
		await post({ name: "Bob", alias: "bob" });
		const body = (await (
			await mount().request("http://x/api/developers")
		).json()) as { items: { alias: string; tagIds: string[] }[] };
		const by = new Map(body.items.map((i) => [i.alias, i.tagIds]));
		expect(by.get("ada")).toEqual(["g-fe"]);
		expect(by.get("bob")).toEqual([]);
	});

	test("a PATCH on an archived developer writes no tags", async () => {
		const dev = await created({ name: "Ada", alias: "ada" });
		sqlite.raw
			.query("UPDATE developers SET archived_at = unixepoch() WHERE id = ?")
			.run(dev.id);
		expect((await patch(dev.id, { tagIds: ["g-fe"] })).status).toBe(404);
		expect(
			sqlite.raw
				.query(
					"SELECT COUNT(*) AS n FROM developer_tags WHERE developer_id = ?",
				)
				.get(dev.id),
		).toMatchObject({ n: 0 });
	});
});

describe("tags on teams", () => {
	const postTeam = (body: unknown) =>
		mount().request("http://x/api/teams", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const patchTeam = (id: string, body: unknown) =>
		mount().request(`http://x/api/teams/${id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	test("a create stores and echoes tag ids", async () => {
		const res = await postTeam({ name: "Core", tagIds: ["g-fe"] });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ tagIds: ["g-fe"] });
	});

	test("omitting tagIds on PATCH leaves them alone", async () => {
		const t = (await (
			await postTeam({ name: "Core", tagIds: ["g-fe"] })
		).json()) as { id: string };
		const res = await patchTeam(t.id, { name: "Core Team" });
		expect(await res.json()).toMatchObject({
			name: "Core Team",
			tagIds: ["g-fe"],
		});
	});

	test("an empty array clears them", async () => {
		const t = (await (
			await postTeam({ name: "Core", tagIds: ["g-fe"] })
		).json()) as { id: string };
		const res = await patchTeam(t.id, { tagIds: [] });
		expect(await res.json()).toMatchObject({ tagIds: [] });
	});

	test("a PATCH on a missing team writes no tags", async () => {
		expect((await patchTeam("nope", { tagIds: ["g-fe"] })).status).toBe(404);
		expect(
			sqlite.raw.query("SELECT COUNT(*) AS n FROM team_tags").get(),
		).toMatchObject({ n: 0 });
	});

	test("the list route reports each team's tags", async () => {
		await postTeam({ name: "Core", tagIds: ["g-fe"] });
		const body = (await (
			await mount().request("http://x/api/teams")
		).json()) as { items: { name: string; tagIds: string[] }[] };
		const core = body.items.find((i) => i.name === "Core");
		expect(core?.tagIds).toEqual(["g-fe"]);
	});
});
