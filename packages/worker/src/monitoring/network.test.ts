import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import app from "../index";
import { collectorNetworkRoute } from "../routes/collection";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import type { AppEnv } from "../types";
import { measuredJevFetch, queryNetwork, recordNetwork } from "./network";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
test("minute buckets dedupe attempts, include failures and retain only two hours", async () => {
	const now = 1800000000;
	const event = {
		id: crypto.randomUUID(),
		kind: "adoDiscovery" as const,
		at: now - 60,
	};
	await recordNetwork(sqlite.db, event, now);
	await recordNetwork(sqlite.db, event, now);
	for (const [kind, at] of [
		["adoChecks", now],
		["adoDetails", now - 3540],
		["jev", now + 60],
		["jev", now - 3600],
		["jev", now - 7201],
	] as const)
		await recordNetwork(sqlite.db, { id: crypto.randomUUID(), kind, at }, now);
	const result = await queryNetwork(sqlite.db, now);
	expect(result.buckets).toHaveLength(60);
	expect(result.buckets[0]?.adoDetails).toBe(1);
	expect(result.buckets[58]?.adoDiscovery).toBe(1);
	expect(result.buckets[59]?.adoChecks).toBe(1);
	expect(result.buckets.reduce((n, b) => n + b.jev, 0)).toBe(0);
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM network_requests").get(),
	).toEqual({ n: 5 });
});
test("Jev records HTTP errors and transport failures without changing provider results", async () => {
	const fetcher = mock<typeof fetch>()
		.mockResolvedValueOnce(new Response("", { status: 402 }))
		.mockRejectedValueOnce(new Error("offline"));
	const measured = measuredJevFetch(
		sqlite.db,
		Object.assign(fetcher, { preconnect: fetch.preconnect }),
	);
	expect((await measured("https://api.typesafe.ai")).status).toBe(402);
	await expect(measured("https://api.typesafe.ai")).rejects.toThrow("offline");
	expect(
		(
			await queryNetwork(sqlite.db, Math.floor(Date.now() / 1000))
		).buckets.reduce((n, b) => n + b.jev, 0),
	).toBe(2);
	sqlite.raw.run("DROP TABLE network_requests");
	fetcher.mockResolvedValueOnce(new Response("ok"));
	expect((await measured("https://api.typesafe.ai")).status).toBe(200);
});
test("collector write validates, dedupes and restricts access; chart query is read only", async () => {
	const event = {
		id: crypto.randomUUID(),
		kind: "adoChecks",
		at: Math.floor(Date.now() / 1000),
	};
	const post = (body: unknown, host = "localhost") =>
		app.request(
			`http://${host}/api/collector/network`,
			{
				method: "POST",
				headers: { host, "content-type": "application/json" },
				body: JSON.stringify(body),
			},
			{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", SIGNOFF_DEMO_MODE: "1" },
		);
	expect((await post(event)).status).toBe(200);
	expect((await post(event)).status).toBe(200);
	for (const body of [
		{ ...event, kind: "jev" },
		{ ...event, at: 0 },
		{ ...event, at: event.at + 120 },
		{ ...event, url: "private" },
	])
		expect((await post(body)).status).toBe(400);
	const remote = new Hono<AppEnv>();
	remote.post("/", collectorNetworkRoute);
	expect(
		(
			await remote.request(
				"http://remote.example/",
				{ method: "POST", headers: { host: "remote.example" } },
				{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
			)
		).status,
	).toBe(403);
	const read = await app.request(
		"http://localhost/api/query/v1/network",
		{ headers: { host: "localhost" } },
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", SIGNOFF_DEMO_MODE: "1" },
	);
	expect(read.status).toBe(200);
	const data = (await read.json()) as { buckets: { adoChecks: number }[] };
	expect(data.buckets.reduce((n, b) => n + b.adoChecks, 0)).toBe(1);
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM collection_jobs").get(),
	).toEqual({ n: 0 });
});
