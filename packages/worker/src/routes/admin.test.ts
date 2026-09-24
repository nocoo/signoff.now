import { afterEach, beforeEach, expect, test } from "bun:test";
import { adminDirectorySchema } from "@signoff/domain/principal";
import app from "../index";
import { setAccessJwtVerifierForTests } from "../middleware/access-auth";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
beforeEach(() => {
	sqlite = createSqliteD1();
	setAccessJwtVerifierForTests(async (jwt) => ({
		email: jwt,
		name: jwt,
		service: false,
	}));
});
afterEach(() => {
	setAccessJwtVerifierForTests(null);
	sqlite.close();
});

const REMOTE = {
	CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
	CF_ACCESS_AUD: "aud",
	SIGNOFF_ADMIN_EMAILS: "root@x.io",
};
function send(
	method: string,
	path: string,
	body?: unknown,
	jwt: string | null = "root@x.io",
) {
	return app.request(
		`https://signoff.hexly.ai/api/admin${path}`,
		{
			method,
			headers: {
				host: "signoff.hexly.ai",
				"content-type": "application/json",
				...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		jwt === null
			? { DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" }
			: { DB: sqlite.db, ...REMOTE },
	);
}
const directory = async (jwt?: string) =>
	adminDirectorySchema.parse(
		await (await send("GET", "/directory", undefined, jwt)).json(),
	);
const localSend = (method: string, path: string, body?: unknown) =>
	app.request(
		`http://localhost/api/admin${path}`,
		{
			method,
			headers: { host: "localhost", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" },
	);

test("admins list tenants, members and both admin sources", async () => {
	expect(await directory()).toEqual({
		tenants: [{ id: "default", name: "Default", members: [] }],
		admins: [
			{
				principal: "email:root@x.io",
				source: "environment",
				createdBy: null,
				createdAt: null,
			},
		],
	});
});

test("members are added idempotently by email or service id and removed", async () => {
	const add = await send("POST", "/tenants/default/members", {
		member: " Maya@X.io ",
	});
	expect(add.status).toBe(201);
	expect(await add.json()).toEqual({
		status: "added",
		principal: "email:maya@x.io",
	});
	expect(
		await (
			await send("POST", "/tenants/default/members", { member: "maya@x.io" })
		).json(),
	).toEqual({ status: "already_member", principal: "email:maya@x.io" });
	expect(
		(
			await send("POST", "/tenants/default/members", {
				member: "service:ci.access",
			})
		).status,
	).toBe(201);
	const listed = await directory();
	expect(listed.tenants[0]?.members.map((m) => m.principal)).toEqual([
		"email:maya@x.io",
		"service:ci.access",
	]);
	expect(listed.tenants[0]?.members[0]?.addedBy).toBe("email:root@x.io");

	// The new member can now reach tenant data, but not admin routes.
	expect((await send("GET", "/directory", undefined, "maya@x.io")).status).toBe(
		403,
	);

	const removed = await send(
		"DELETE",
		`/tenants/default/members/${encodeURIComponent("email:maya@x.io")}`,
	);
	expect(await removed.json()).toEqual({ status: "removed" });
	expect(
		await (
			await send(
				"DELETE",
				`/tenants/default/members/${encodeURIComponent("email:maya@x.io")}`,
			)
		).json(),
	).toEqual({ status: "not_member" });
});

test("member writes validate input and tenant existence", async () => {
	for (const body of [{ member: "maya" }, { member: "" }, {}, { x: 1 }])
		expect((await send("POST", "/tenants/default/members", body)).status).toBe(
			400,
		);
	const raw = await app.request(
		"https://signoff.hexly.ai/api/admin/tenants/default/members",
		{
			method: "POST",
			headers: {
				host: "signoff.hexly.ai",
				"cf-access-jwt-assertion": "root@x.io",
			},
			body: "{",
		},
		{ DB: sqlite.db, ...REMOTE },
	);
	expect(raw.status).toBe(400);
	expect(
		(await send("POST", "/tenants/missing/members", { member: "a@x.io" }))
			.status,
	).toBe(404);
	expect((await send("DELETE", "/tenants/default/members/bogus")).status).toBe(
		400,
	);
});

test("database admins are managed; environment admins and self-removal are protected", async () => {
	const add = await send("POST", "/admins", { member: "ops@x.io" });
	expect(add.status).toBe(201);
	expect(
		await (await send("POST", "/admins", { member: "ops@x.io" })).json(),
	).toEqual({ status: "already_admin", principal: "email:ops@x.io" });
	expect(
		await (await send("POST", "/admins", { member: "ROOT@x.io" })).json(),
	).toEqual({ status: "environment_admin", principal: "email:root@x.io" });

	const listed = await directory("ops@x.io");
	expect(listed.admins.map((a) => [a.principal, a.source])).toEqual([
		["email:root@x.io", "environment"],
		["email:ops@x.io", "database"],
	]);

	const self = await send(
		"DELETE",
		`/admins/${encodeURIComponent("email:ops@x.io")}`,
		undefined,
		"ops@x.io",
	);
	expect(self.status).toBe(409);
	const env = await send(
		"DELETE",
		`/admins/${encodeURIComponent("email:root@x.io")}`,
	);
	expect(env.status).toBe(409);
	expect(
		await (
			await send("DELETE", `/admins/${encodeURIComponent("email:ops@x.io")}`)
		).json(),
	).toEqual({ status: "removed" });
	expect(
		await (
			await send("DELETE", `/admins/${encodeURIComponent("email:ops@x.io")}`)
		).json(),
	).toEqual({ status: "not_admin" });
	expect((await directory()).admins).toHaveLength(1);
});

test("a stored admin that is also an environment admin is listed once", async () => {
	sqlite.raw
		.query(
			"INSERT INTO admins(principal,created_by,created_at) VALUES('email:root@x.io','test',1)",
		)
		.run();
	expect((await directory()).admins).toEqual([
		{
			principal: "email:root@x.io",
			source: "environment",
			createdBy: null,
			createdAt: null,
		},
	]);
});

test("local trust manages membership and is recorded as local", async () => {
	expect(
		(await localSend("POST", "/tenants/default/members", { member: "a@x.io" }))
			.status,
	).toBe(201);
	expect(sqlite.raw.query("SELECT added_by FROM tenant_members").get()).toEqual(
		{ added_by: "local" },
	);
	expect(
		(await localSend("POST", "/admins", { member: "b@x.io" })).status,
	).toBe(201);
	expect(
		(await localSend("DELETE", `/admins/${encodeURIComponent("email:b@x.io")}`))
			.status,
	).toBe(200);
});

test("non-admins and anonymous callers cannot use admin routes", async () => {
	expect(
		(await send("POST", "/admins", { member: "a@x.io" }, "someone@x.io"))
			.status,
	).toBe(403);
	const anonymous = await app.request(
		"https://signoff.hexly.ai/api/admin/directory",
		{ headers: { host: "signoff.hexly.ai" } },
		{ DB: sqlite.db, ...REMOTE },
	);
	expect(anonymous.status).toBe(401);
});
