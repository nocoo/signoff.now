import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import app from "../index";
import { addObservation } from "../monitoring/observations";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import type { AppEnv } from "../types";
import {
	collectorScheduleRoute,
	refreshQueuesRoute,
	refreshSettingsRoute,
} from "./refresh";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
const request = (path: string, method = "POST", body?: unknown) =>
	app.request(
		`http://localhost/api/${path}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db },
	);

test("page notifications are retired and neither legacy list ticks nor queries enqueue discovery", async () => {
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	expect(
		(await request("collection/view", "POST", { visible: true })).status,
	).toBe(410);
	for (const kind of ["list", "details", undefined])
		expect(
			(await request("collector/schedule", "POST", kind ? { kind } : {}))
				.status,
		).toBe(200);
	expect((await request("collection/refresh", "GET")).status).toBe(200);
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM collection_jobs").get(),
	).toEqual({ n: 0 });
});

test("only check cooldown can be configured; defaults to five minutes and zero disables periodic work", async () => {
	const initial = (await (
		await request("collection/refresh", "GET")
	).json()) as { kind: string; cooldownSeconds: number }[];
	expect(initial.find((q) => q.kind === "details")?.cooldownSeconds).toBe(300);
	for (const value of [120, 300, 0]) {
		const response = await request("collection/settings", "PATCH", {
			detailCooldownSeconds: value,
		});
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as typeof initial).find(
				(q) => q.kind === "details",
			)?.cooldownSeconds,
		).toBe(value);
	}
	expect(
		(await request("collection/settings", "PATCH", { listCooldownSeconds: 0 }))
			.status,
	).toBe(200);
	for (const value of [
		{ listCooldownSeconds: 120 },
		{ detailCooldownSeconds: -1 },
		{ detailCooldownSeconds: 1 },
		{},
		null,
		{ detailCooldownSeconds: 300, unknown: true },
	])
		expect((await request("collection/settings", "PATCH", value)).status).toBe(
			400,
		);
	expect((await request("collection/settings", "PATCH")).status).toBe(400);
});

test("scheduler follows active watches even when the browser is absent", async () => {
	seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	await addObservation(sqlite.db, "cli", { pullId: pull.id }, 100);
	expect(
		(await request("collector/schedule", "POST", { kind: "details" })).status,
	).toBe(200);
	const queues = (await (
		await request("collection/refresh", "GET")
	).json()) as { kind: string; roundId: string | null; totalJobs: number }[];
	expect(queues.find((q) => q.kind === "details")).toMatchObject({
		totalJobs: 1,
		roundId: null,
	});
	expect(
		(await request("collector/schedule", "POST", { kind: "unknown" })).status,
	).toBe(400);
	expect((await request("collector/schedule")).status).toBe(400);
});

test("scheduler configuration and reads stay on loopback", async () => {
	const direct = new Hono<AppEnv>()
		.get("/refresh", refreshQueuesRoute)
		.patch("/refresh", refreshSettingsRoute)
		.post("/schedule", collectorScheduleRoute);
	for (const [method, path] of [
		["GET", "/refresh"],
		["PATCH", "/refresh"],
		["POST", "/schedule"],
	])
		expect(
			(
				await direct.request(
					`https://signoff.hexly.ai${path}`,
					{ method, headers: { host: "signoff.hexly.ai" } },
					{ DB: sqlite.db },
				)
			).status,
		).toBe(403);
});
