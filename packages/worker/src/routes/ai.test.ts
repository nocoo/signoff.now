import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ACTIONS, JEV_MODEL } from "@signoff/domain/ai-readiness";
import app from "../index";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";
import { aiRoutes } from "./ai";

let sqlite: SqliteD1;
const master = btoa("x".repeat(32));
beforeEach(() => {
	sqlite = createSqliteD1();
});
afterEach(() => sqlite.close());
function request(
	path = "/settings",
	method = "GET",
	body?: unknown,
	extra: Record<string, string> = {},
	secret: string | undefined = master,
) {
	return app.request(
		`http://localhost/api/ai${path}`,
		{
			method,
			headers: {
				host: "localhost",
				"content-type": "application/json",
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: sqlite.db, SIGNOFF_AI_ENCRYPTION_KEY: secret },
	);
}
const settings = async () =>
	(await (await request()).json()) as {
		configured: boolean;
		revision: number;
		testState: string;
		testError: string | null;
	};
test("secret write, reload metadata, CAS replacement and removal never reveal plaintext", async () => {
	expect(await settings()).toMatchObject({
		configured: false,
		revision: 1,
		testState: "untested",
	});
	expect(
		(
			await request("/settings", "PUT", {
				revision: 1,
				apiKey: "test-private-key",
			})
		).status,
	).toBe(200);
	const metadata = await settings();
	expect(metadata).toMatchObject({
		configured: true,
		revision: 2,
		testState: "untested",
	});
	expect(JSON.stringify(metadata)).not.toContain("test-private-key");
	const stored = sqlite.raw
		.query("SELECT encrypted_key FROM ai_settings")
		.get() as { encrypted_key: string };
	expect(stored.encrypted_key).not.toContain("test-private-key");
	expect(
		(await request("/settings", "PUT", { revision: 1, apiKey: "other" }))
			.status,
	).toBe(409);
	expect(
		(await request("/settings", "PUT", { revision: 2, apiKey: "replacement" }))
			.status,
	).toBe(200);
	expect(
		(await request("/settings", "PUT", { revision: 3, apiKey: null })).status,
	).toBe(200);
	expect((await settings()).configured).toBe(false);
	expect((await request("/test", "POST")).status).toBe(400);
	expect((await settings()).testState).toBe("error");
	expect(
		(
			await request(
				"/settings",
				"PUT",
				{ revision: 4, apiKey: "key" },
				{},
				"invalid",
			)
		).status,
	).toBe(400);
	expect(
		(await request("/settings", "PUT", { revision: 4, apiKey: "" })).status,
	).toBe(400);
	expect(
		(
			await request("/settings", "PUT", {
				revision: 4,
				apiKey: "x".repeat(9000),
			})
		).status,
	).toBe(400);
	expect((await request("/retry", "POST")).status).toBe(200);
	expect(await (await request("/tick", "POST")).json()).toEqual({
		processed: false,
	});
});
test("rejects untrusted origins and nonlocal hosts", async () => {
	expect(
		(
			await request("/settings", "GET", undefined, {
				origin: "null",
			})
		).status,
	).toBe(403);
	expect(
		(
			await aiRoutes.request(
				"http://signoff.hexly.ai/settings",
				{ headers: { host: "signoff.hexly.ai" } },
				{ DB: sqlite.db },
			)
		).status,
	).toBe(403);
	expect(
		(
			await request("/settings", "GET", undefined, {
				origin: "https://signoff.dev.hexly.ai",
			})
		).status,
	).toBe(200);
});
test("bounded connection request handles invalid keys, typed success and key replacement during test", async () => {
	await request("/settings", "PUT", { revision: 1, apiKey: "test-key" });
	const fetcher = spyOn(
		globalThis as {
			fetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
		},
		"fetch",
	).mockImplementation(
		async () => new Response("Do not expose provider content", { status: 401 }),
	);
	try {
		expect((await request("/test", "POST")).status).toBe(400);
		expect((await settings()).testError).toContain("rejected");
		fetcher.mockImplementation(async (_url, init) => {
			expect(init?.redirect).toBe("manual");
			const payload = JSON.parse(String(init?.body));
			expect(payload.state.connectionTest).toBe(true);
			expect(payload.state).not.toHaveProperty("apiKey");
			const answer = (choice: string, keys: string[]) => ({
				type: "choice",
				choice,
				confidence: 1,
				probabilities: Object.fromEntries(
					keys.map((k) => [k, Number(k === choice)]),
				),
			});
			return Response.json({
				model: JEV_MODEL,
				answers: {
					readiness: answer("unknown", ["on_track", "attention", "unknown"]),
					action: answer("investigate", Object.keys(ACTIONS)),
				},
			});
		});
		expect((await request("/test", "POST")).status).toBe(200);
		expect((await settings()).testState).toBe("valid");
		fetcher.mockImplementation(async () => {
			sqlite.raw.query("UPDATE ai_settings SET revision=revision+1").run();
			return new Response(null, { status: 401 });
		});
		expect((await request("/test", "POST")).status).toBe(409);
	} finally {
		fetcher.mockRestore();
	}
});
