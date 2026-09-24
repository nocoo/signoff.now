import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	AVATAR_REFRESH_SECONDS,
	type AvatarTask,
} from "@signoff/domain/avatars";
import app from "../index";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { claimAvatars } from "./avatars";

const ACCESS = {
	CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
	CF_ACCESS_AUD: "aud",
};
let sqlite: SqliteD1;
const url = "https://dev.azure.com/acme/_api/_common/identityImage?id=alice";
const now = () => Math.floor(Date.now() / 1000);
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
const request = (
	path: string,
	method = "GET",
	body?: unknown,
	headers: Record<string, string> = {},
) =>
	app.request(
		`http://localhost/api/${path}`,
		{
			method,
			headers: {
				host: "localhost",
				"content-type": "application/json",
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", SIGNOFF_DEMO_MODE: "0" },
	);
const image = (source = "live") =>
	`avatars?${new URLSearchParams({ source, url })}`;
const seed = (source = "cli", avatarUrl = url, organization = "acme") =>
	sqlite.raw
		.query("INSERT INTO avatar_cache(source,url,organization) VALUES(?,?,?)")
		.run(source, avatarUrl, organization);
const publish = (task: AvatarTask, base64 = "AQID") =>
	request("collector/avatars/publish", "POST", {
		...task,
		contentType: "image/png",
		base64,
	});

test("image reads only durable cache, isolates sources, and revalidates by ETag", async () => {
	const missing = await request(image());
	expect(missing.status).toBe(404);
	expect(missing.headers.get("cache-control")).toBe("no-store");
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM avatar_cache").get(),
	).toEqual({ n: 0 });
	seed();
	const task = (await claimAvatars(sqlite.db, now()))[0]!;
	expect((await publish(task)).status).toBe(200);
	const cached = await request(image());
	expect(cached.status).toBe(200);
	expect(cached.headers.get("content-type")).toBe("image/png");
	expect([...new Uint8Array(await cached.arrayBuffer())]).toEqual([1, 2, 3]);
	expect(
		(
			await request(image(), "GET", undefined, {
				"if-none-match": cached.headers.get("etag")!,
			})
		).status,
	).toBe(304);
	expect((await request(image("sample"))).status).toBe(404);
	expect(
		await claimAvatars(sqlite.db, now() + AVATAR_REFRESH_SECONDS - 10),
	).toEqual([]);
	expect(
		await claimAvatars(sqlite.db, now() + AVATAR_REFRESH_SECONDS + 1),
	).toHaveLength(1);
});

test("failed refresh keeps stale bytes, retries later, and fences superseded leases", async () => {
	seed();
	const first = (await claimAvatars(sqlite.db, now()))[0]!;
	await publish(first);
	sqlite.raw.exec("UPDATE avatar_cache SET due_at=0");
	const refresh = (await claimAvatars(sqlite.db, now()))[0]!;
	expect((await publish(first, "BAUG")).status).toBe(409);
	expect(
		(await request("collector/avatars/fail", "POST", refresh)).status,
	).toBe(200);
	expect([
		...new Uint8Array(await (await request(image())).arrayBuffer()),
	]).toEqual([1, 2, 3]);
	expect(await claimAvatars(sqlite.db, now() + 3590)).toEqual([]);
	expect(await claimAvatars(sqlite.db, now() + 3601)).toHaveLength(1);
});

test("candidate capture follows cached PR author and reviewer writes", async () => {
	seedProject(sqlite);
	const pull = seedPull(sqlite, {
		author: { id: "author", name: "Alice", avatarUrl: url },
		reviewers: [
			{
				id: "reviewer",
				name: "Bob",
				vote: "pending",
				required: false,
				avatarUrl: url.replace("alice", "bob"),
			},
		],
	});
	expect(
		sqlite.raw.query("SELECT url FROM avatar_cache ORDER BY url").all(),
	).toEqual([{ url }, { url: url.replace("alice", "bob") }]);
	sqlite.raw.query("UPDATE pull_requests SET snapshot=? WHERE id=?").run(
		JSON.stringify({
			...pull,
			author: { ...pull.author, avatarUrl: url.replace("alice", "carol") },
		}),
		pull.id,
	);
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM avatar_cache").get(),
	).toEqual({ n: 3 });
});

test("claims exclude arbitrary URLs and cross-organization avatars before provider work", async () => {
	seed("cli", "http://127.0.0.1/private");
	seed("cli", url, "other");
	seed("cli", "https://dev.azure.com/acme/_apis/git/repositories?id=alice");
	expect(await claimAvatars(sqlite.db, now())).toEqual([]);
	expect(
		sqlite.raw.query("SELECT COUNT(*) AS n FROM avatar_cache").get(),
	).toEqual({ n: 0 });
});

test("bounded claims do not duplicate leases and reject invalid publication", async () => {
	for (let n = 0; n < 8; n++) seed("cli", `${url}${n}`);
	const first = await claimAvatars(sqlite.db, now());
	const second = await claimAvatars(sqlite.db, now());
	expect(first).toHaveLength(4);
	expect(second).toHaveLength(4);
	expect(new Set([...first, ...second].map((task) => task.url)).size).toBe(8);
	expect(await claimAvatars(sqlite.db, now())).toEqual([]);
	expect((await publish(first[0]!, "not base64")).status).toBe(400);
	expect(
		(
			await request("collector/avatars/publish", "POST", {
				...first[0],
				contentType: "image/svg+xml",
				base64: "AQID",
			})
		).status,
	).toBe(400);
});

test("repeated PR upserts preserve cached author and reviewer avatars", () => {
	seedProject(sqlite);
	const pull = seedPull(sqlite, {
		author: { id: "author", name: "Alice", avatarUrl: url },
		reviewers: [
			{
				id: "reviewer",
				name: "Bob",
				vote: "pending",
				required: false,
				avatarUrl: url.replace("alice", "bob"),
			},
		],
	});
	sqlite.raw
		.query("UPDATE avatar_cache SET body=?,etag='retained',due_at=99")
		.run(new Uint8Array([1, 2, 3]));
	const row = sqlite.raw
		.query(
			"SELECT id,project_id,repository_id,external_id,state,updated_at,snapshot FROM pull_requests WHERE id=?",
		)
		.get(pull.id) as Record<string, string>;
	for (let i = 0; i < 2; i++)
		sqlite.raw
			.query(
				"INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
			)
			.run(
				row.id!,
				row.project_id!,
				row.repository_id!,
				row.external_id!,
				row.state!,
				row.updated_at!,
				row.snapshot!,
			);
	expect(
		sqlite.raw.query("SELECT etag,due_at FROM avatar_cache ORDER BY url").all(),
	).toEqual([
		{ etag: "retained", due_at: 99 },
		{ etag: "retained", due_at: 99 },
	]);
});

test("collector avatar endpoints reject remote callers and malformed payloads", async () => {
	for (const action of ["claim", "publish", "fail"]) {
		const remote = await app.request(
			`https://public.example/api/collector/avatars/${action}`,
			{ method: "POST", headers: { host: "public.example" } },
			{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1", ...ACCESS },
		);
		expect(remote.status).toBe(401);
	}
	expect((await request("avatars?source=live")).status).toBe(400);
	seed();
	const response = await request("collector/avatars/claim", "POST");
	expect(response.status).toBe(200);
	const tasks = (await response.json()) as AvatarTask[];
	expect(tasks).toHaveLength(1);
	expect((await request("collector/avatars/fail", "POST", {})).status).toBe(
		400,
	);
	expect((await request("collector/avatars/publish", "POST")).status).toBe(400);
	expect(
		(
			await request("collector/avatars/publish", "POST", {
				...tasks[0],
				contentType: "image/png",
				base64: "A".repeat(370 * 1024),
			})
		).status,
	).toBe(413);
	expect(
		(
			await request("collector/avatars/publish", "POST", {
				...tasks[0],
				url: "https://example.com/avatar.png",
				contentType: "image/png",
				base64: "AQID",
			})
		).status,
	).toBe(400);
	expect(
		(await publish(tasks[0]!, Buffer.alloc(256 * 1024 + 1).toString("base64")))
			.status,
	).toBe(400);
	expect(sqlite.raw.query("SELECT body FROM avatar_cache").get()).toEqual({
		body: null,
	});
});
