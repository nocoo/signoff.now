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
import { teamsCreateRoute, teamsPatchRoute } from "./teams.js";

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

	test("a script-bearing team avatar is refused", async () => {
		expect(
			(await postTeam({ name: "Eps", avatarUrl: "javascript:alert(1)" }))
				.status,
		).toBe(400);
	});
});
