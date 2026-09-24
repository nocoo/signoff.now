import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { collectorClaimSchema } from "@signoff/domain/collection";
import {
	connectorListSchema,
	connectorMeSchema,
} from "@signoff/domain/connector";
import app from "../index";
import { setAccessJwtVerifierForTests } from "../middleware/access-auth";
import { enqueueDiscovery } from "../monitoring/observations";
import { seedProject } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	setAccessJwtVerifierForTests(async (jwt) =>
		jwt.startsWith("service:")
			? { email: null, name: jwt.slice(8), service: true }
			: { email: jwt, name: jwt, service: false },
	);
	for (const principal of ["email:maya@x.io", "email:li@x.io"])
		sqlite.raw
			.query(
				"INSERT INTO tenant_members(tenant_id,principal,added_by,added_at) VALUES('default',?,'test',1)",
			)
			.run(principal);
});
afterEach(() => {
	setAccessJwtVerifierForTests(null);
	sqlite.close();
});

const ENV = {
	CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
	CF_ACCESS_AUD: "aud",
	SIGNOFF_ADMIN_EMAILS: "root@x.io",
};
const CALLBACK = "http://127.0.0.1:5123/callback";
const STATE = "s".repeat(32);

function browser(
	path: string,
	jwt: string | null,
	init: { method?: string; body?: unknown; origin?: string } = {},
) {
	return app.request(
		`https://signoff.hexly.ai${path}`,
		{
			method: init.method ?? "GET",
			headers: {
				host: "signoff.hexly.ai",
				"content-type": "application/json",
				...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
				...(init.origin ? { origin: init.origin } : {}),
			},
			...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
		},
		{ DB: sqlite.db, ...ENV },
	);
}
function machine(path: string, token?: string, body?: unknown) {
	return app.request(
		`https://signoff-ingest.hexly.ai${path}`,
		{
			method:
				body === undefined && !path.includes("collector/") ? "GET" : "POST",
			headers: {
				host: "signoff-ingest.hexly.ai",
				"content-type": "application/json",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, ...ENV, SIGNOFF_PIPELINE_WRITE_TOKEN: "pipeline-secret" },
	);
}
async function login(jwt: string, name = "Laptop") {
	const query = new URLSearchParams({
		callback: CALLBACK,
		state: STATE,
		name,
		platform: "darwin-arm64",
		version: "0.3.0",
	});
	const response = await browser(`/api/auth/cli?${query}`, jwt);
	expect(response.status).toBe(302);
	const target = new URL(response.headers.get("location")!);
	return {
		target,
		token: target.searchParams.get("api_key")!,
		id: target.searchParams.get("connector_id")!,
	};
}
const assignOwner = (projectId: string, dataOwner: string | null) =>
	browser(`/api/projects/${projectId}/data-owner`, "root@x.io", {
		method: "PUT",
		body: { dataOwner },
	});

describe("browser sign-in", () => {
	test("issues a hashed connector token only to the loopback callback", async () => {
		const { target, token, id } = await login("Maya@X.io");
		expect(target.origin + target.pathname).toBe(CALLBACK);
		expect(target.searchParams.get("state")).toBe(STATE);
		expect(target.searchParams.get("owner")).toBe("email:maya@x.io");
		expect(target.searchParams.get("email")).toBe("maya@x.io");
		expect(token).toMatch(/^sfc_[A-Za-z0-9_-]{43}$/);
		const row = sqlite.raw
			.query(
				"SELECT owner,name,platform,version,token_hash FROM connectors WHERE id=?",
			)
			.get(id) as Record<string, string>;
		expect(row).toMatchObject({
			owner: "email:maya@x.io",
			name: "Laptop",
			platform: "darwin-arm64",
			version: "0.3.0",
		});
		expect(row.token_hash).not.toContain(token);
		expect(row.token_hash).toHaveLength(64);
	});

	test("rejects non-loopback callbacks, anonymous and service callers", async () => {
		const bad = new URLSearchParams({
			callback: "https://evil.example:5123/callback",
			state: STATE,
		});
		expect((await browser(`/api/auth/cli?${bad}`, "maya@x.io")).status).toBe(
			400,
		);
		const ok = new URLSearchParams({ callback: CALLBACK, state: STATE });
		expect((await browser(`/api/auth/cli?${ok}`, null)).status).toBe(401);
		expect(
			(await browser(`/api/auth/cli?${ok}`, "service:ci.access")).status,
		).toBe(403);
		expect(sqlite.raw.query("SELECT COUNT(*) n FROM connectors").get()).toEqual(
			{ n: 0 },
		);
	});
});

describe("connector identity", () => {
	test("reports itself and the projects its owner refreshes", async () => {
		seedProject(sqlite, { name: "Platform" });
		const { token, id } = await login("maya@x.io");
		expect((await assignOwner("live-project", "email:maya@x.io")).status).toBe(
			200,
		);
		const me = connectorMeSchema.parse(
			await (await machine("/api/connector/v1/me", token)).json(),
		);
		expect(me).toMatchObject({
			connectorId: id,
			owner: "email:maya@x.io",
			projects: [{ id: "live-project", name: "Platform" }],
		});
	});

	test("connector tokens reach only collector routes; pipeline tokens never do", async () => {
		const { token } = await login("maya@x.io");
		expect((await machine("/api/connector/v1/me")).status).toBe(401);
		expect(
			(await machine("/api/connector/v1/me", `sfc_${"x".repeat(43)}`)).status,
		).toBe(401);
		expect(
			(await machine("/api/connector/v1/me", "pipeline-secret")).status,
		).toBe(401);
		expect(
			(await machine("/api/collector/claim", "pipeline-secret", {})).status,
		).toBe(403);
		expect((await machine("/api/workbench", token)).status).toBe(403);
		expect((await machine("/api/pipeline/bootstrap", token)).status).toBe(403);
	});

	test("heartbeats record capabilities without touching the local heartbeat", async () => {
		const { token, id } = await login("maya@x.io");
		const beat = await machine("/api/collector/heartbeat", token, {
			state: "ready",
			message: "Idle",
			version: "0.4.0",
			capabilities: {
				az: { installed: true, loggedIn: true },
				gh: { installed: false, loggedIn: false },
			},
		});
		expect(beat.status).toBe(200);
		const list = connectorListSchema.parse(
			await (await browser("/api/connectors", "maya@x.io")).json(),
		);
		expect(list.connectors).toHaveLength(1);
		expect(list.connectors[0]).toMatchObject({
			id,
			online: true,
			state: "ready",
			version: "0.4.0",
			capabilities: { az: { installed: true, loggedIn: true } },
		});
		expect(
			sqlite.raw.query("SELECT COUNT(*) n FROM collector_heartbeat").get(),
		).toEqual({ n: 0 });
	});
});

describe("owner routing and leases", () => {
	async function queueDiscovery() {
		const project = seedProject(sqlite, { repositories: ["web-app"] });
		await enqueueDiscovery(sqlite.db, project, ["web-app"], 1_000);
		return project;
	}

	test("a connector claims only its owner's projects", async () => {
		await queueDiscovery();
		const maya = await login("maya@x.io");
		const li = await login("li@x.io");
		expect(
			await (await machine("/api/collector/claim", maya.token, {})).json(),
		).toBeNull();
		await assignOwner("live-project", "email:li@x.io");
		expect(
			await (await machine("/api/collector/claim", maya.token, {})).json(),
		).toBeNull();
		const claim = collectorClaimSchema.parse(
			await (await machine("/api/collector/claim", li.token, {})).json(),
		);
		expect(claim.project.id).toBe("live-project");
		expect(
			sqlite.raw
				.query("SELECT lease_connector_id FROM collection_jobs WHERE id=?")
				.get(claim.job.id),
		).toEqual({ lease_connector_id: li.id });
	});

	test("another connector, a reassigned owner or a removed member loses the lease", async () => {
		await queueDiscovery();
		const li = await login("li@x.io");
		const liSpare = await login("li@x.io", "Desktop");
		await assignOwner("live-project", "email:li@x.io");
		const claim = collectorClaimSchema.parse(
			await (await machine("/api/collector/claim", li.token, {})).json(),
		);
		const progress = (token: string) =>
			machine(`/api/collector/jobs/${claim.job.id}/progress`, token, {
				leaseToken: claim.leaseToken,
				completedPulls: 0,
				totalPulls: null,
				message: "Working",
			});
		expect((await progress(li.token)).status).toBe(200);
		expect((await progress(liSpare.token)).status).toBe(409);
		await assignOwner("live-project", "email:maya@x.io");
		expect((await progress(li.token)).status).toBe(409);
		await assignOwner("live-project", "email:li@x.io");
		expect((await progress(li.token)).status).toBe(200);
		sqlite.raw
			.query("DELETE FROM tenant_members WHERE principal='email:li@x.io'")
			.run();
		expect((await progress(li.token)).status).toBe(409);
	});

	test("owner-scoped scheduling enqueues only the owner's watched work", async () => {
		seedProject(sqlite, {
			id: "mine",
			organization: "org-a",
			repositories: [],
		});
		seedProject(sqlite, {
			id: "theirs",
			organization: "org-b",
			repositories: [],
		});
		sqlite.raw
			.query(
				"UPDATE collection_refresh SET cooldown_seconds=600 WHERE kind='list'",
			)
			.run();
		const maya = await login("maya@x.io");
		await assignOwner("mine", "email:maya@x.io");
		await assignOwner("theirs", "email:li@x.io");
		expect(
			(
				await machine("/api/collector/schedule", maya.token, {
					lane: "discover",
				})
			).status,
		).toBe(200);
		expect(
			sqlite.raw
				.query(
					"SELECT DISTINCT project_id FROM collection_jobs ORDER BY project_id",
				)
				.all(),
		).toEqual([{ project_id: "mine" }]);
	});
});

test("connectors refresh avatars only for their owner's organizations", async () => {
	seedProject(sqlite, { id: "mine", organization: "org-a", repositories: [] });
	for (const org of ["org-a", "org-b"])
		sqlite.raw
			.query(
				"INSERT INTO avatar_cache(source,url,organization,due_at) VALUES('cli',?,?,0)",
			)
			.run(
				`https://dev.azure.com/${org}/_api/_common/identityImage?id=u1`,
				org,
			);
	const maya = await login("maya@x.io");
	expect(
		await (
			await machine("/api/collector/avatars/claim", maya.token, {})
		).json(),
	).toEqual([]);
	await assignOwner("mine", "email:maya@x.io");
	const tasks = (await (
		await machine("/api/collector/avatars/claim", maya.token, {})
	).json()) as { organization: string }[];
	expect(tasks.map((t) => t.organization)).toEqual(["org-a"]);
});

describe("connector management", () => {
	test("owners list and revoke their own connectors; revocation frees leases", async () => {
		const project = seedProject(sqlite, { repositories: ["web-app"] });
		await enqueueDiscovery(sqlite.db, project, ["web-app"], 1_000);
		const maya = await login("maya@x.io");
		const li = await login("li@x.io");
		await assignOwner("live-project", "email:maya@x.io");
		const claim = collectorClaimSchema.parse(
			await (await machine("/api/collector/claim", maya.token, {})).json(),
		);
		const mine = connectorListSchema.parse(
			await (await browser("/api/connectors", "maya@x.io")).json(),
		);
		expect(mine.connectors.map((c) => c.id)).toEqual([maya.id]);
		expect(mine.ownedProjects.map((p) => p.id)).toEqual(["live-project"]);
		expect(
			(
				await browser(`/api/connectors/${li.id}`, "maya@x.io", {
					method: "DELETE",
				})
			).status,
		).toBe(404);
		expect(
			(
				await browser(`/api/connectors/${maya.id}`, "maya@x.io", {
					method: "DELETE",
				})
			).status,
		).toBe(200);
		expect(
			sqlite.raw
				.query(
					"SELECT state,lease_connector_id FROM collection_jobs WHERE id=?",
				)
				.get(claim.job.id),
		).toEqual({ state: "queued", lease_connector_id: null });
		expect((await machine("/api/connector/v1/me", maya.token)).status).toBe(
			401,
		);
		const after = connectorListSchema.parse(
			await (await browser("/api/connectors", "maya@x.io")).json(),
		);
		expect(after.connectors[0]).toMatchObject({ revoked: true, online: false });
		const all = connectorListSchema.parse(
			await (await browser("/api/connectors", "root@x.io")).json(),
		);
		expect(all.connectors).toHaveLength(2);
		expect(
			(
				await browser(`/api/connectors/${li.id}`, "root@x.io", {
					method: "DELETE",
				})
			).status,
		).toBe(200);
	});

	test("expired tokens stop authenticating", async () => {
		const { token } = await login("maya@x.io");
		sqlite.raw.query("UPDATE connectors SET expires_at=1").run();
		expect((await machine("/api/connector/v1/me", token)).status).toBe(401);
	});

	test("data owners must be tenant members and only admins assign them", async () => {
		seedProject(sqlite);
		expect(
			(await assignOwner("live-project", "email:stranger@x.io")).status,
		).toBe(409);
		expect((await assignOwner("missing", "email:maya@x.io")).status).toBe(404);
		expect(
			(
				await browser("/api/projects/live-project/data-owner", "root@x.io", {
					method: "PUT",
					body: { dataOwner: "maya" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await browser("/api/projects/live-project/data-owner", "maya@x.io", {
					method: "PUT",
					body: { dataOwner: "email:maya@x.io" },
				})
			).status,
		).toBe(403);
		expect((await assignOwner("live-project", "email:maya@x.io")).status).toBe(
			200,
		);
		expect((await assignOwner("live-project", null)).status).toBe(200);
		expect(sqlite.raw.query("SELECT data_owner FROM projects").get()).toEqual({
			data_owner: null,
		});
	});

	test("local trust can list and revoke connectors but cannot issue tokens", async () => {
		const maya = await login("maya@x.io");
		const local = (path: string, method = "GET") =>
			app.request(
				`http://localhost${path}`,
				{ method, headers: { host: "localhost" } },
				{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
			);
		const listed = connectorListSchema.parse(
			await (await local("/api/connectors")).json(),
		);
		expect(listed.connectors).toHaveLength(1);
		expect(listed.ownedProjects).toEqual([]);
		sqlite.raw
			.query(
				"INSERT INTO collector_heartbeat(id,last_seen_at,state,message) VALUES(1,unixepoch(),'ready','Watching')",
			)
			.run();
		const withLocal = connectorListSchema.parse(
			await (await local("/api/connectors")).json(),
		);
		expect(withLocal.connectors[0]).toMatchObject({
			id: "local",
			name: "This machine",
			local: true,
			online: true,
			state: "ready",
			message: "Watching",
		});
		const remote = connectorListSchema.parse(
			await (await browser("/api/connectors", "root@x.io")).json(),
		);
		expect(remote.connectors.some((c) => c.local)).toBe(false);
		expect(
			(
				await local(
					`/api/auth/cli?callback=${encodeURIComponent(CALLBACK)}&state=${STATE}`,
				)
			).status,
		).toBe(403);
		expect((await local(`/api/connectors/${maya.id}`, "DELETE")).status).toBe(
			200,
		);
	});
});
