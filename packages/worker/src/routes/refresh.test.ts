import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import app from "../index";
import { addObservation, refreshObserved } from "../monitoring/observations";
import { claimJob, failJob } from "../monitoring/scheduler";
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

test("only discovery scheduling enqueues project list jobs", async () => {
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
		sqlite.raw
			.query(
				"SELECT kind,catalogue_only,scope_json FROM collection_jobs ORDER BY catalogue_only",
			)
			.all(),
	).toEqual([
		{ kind: "list", catalogue_only: 0, scope_json: JSON.stringify(["repo-1"]) },
		{ kind: "list", catalogue_only: 1, scope_json: "[]" },
	]);
});

test("both task cooldowns are configurable and zero disables periodic work", async () => {
	const initial = (await (
		await request("collection/refresh", "GET")
	).json()) as { kind: string; cooldownSeconds: number }[];
	expect(initial.find((q) => q.kind === "details")?.cooldownSeconds).toBe(300);
	expect(initial.find((q) => q.kind === "list")?.cooldownSeconds).toBe(600);
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
		{ listCooldownSeconds: 1 },
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

test("changing cooldown replans queued manual refreshes without bypassing completion", async () => {
	seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite);
	const t = 1000;
	await addObservation(sqlite.db, "cli", { pullId: pull.id }, t);
	const claim = (await claimJob(sqlite.db, t))!;
	await failJob(
		sqlite.db,
		claim.job.id,
		claim.leaseToken,
		"unavailable",
		"Network",
		t + 30,
	);
	const queued = (
		await refreshObserved(sqlite.db, "cli", { pullId: pull.id }, t + 31)
	).jobs[0]!;
	expect(queued.notBefore).toBe(new Date((t + 330) * 1000).toISOString());
	for (const cooldown of [600, 60]) {
		expect(
			(
				await request("collection/settings", "PATCH", {
					detailCooldownSeconds: cooldown,
				})
			).status,
		).toBe(200);
		expect(
			sqlite.raw
				.query("SELECT not_before FROM collection_jobs WHERE id=?")
				.get(queued.id),
		).toEqual({ not_before: t + 30 + cooldown });
		expect(
			await claimJob(sqlite.db, t + 29 + cooldown, { jobId: queued.id }),
		).toBeNull();
	}
	expect(
		(await claimJob(sqlite.db, t + 90, { jobId: queued.id }))?.job.id,
	).toBe(queued.id);
});
