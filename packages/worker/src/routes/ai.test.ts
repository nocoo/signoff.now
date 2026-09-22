import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { CLASSIFICATION, JEV_MODEL } from "@signoff/domain/ai-readiness";
import app from "../index";
import { seedProject } from "../test/pr-fixture";
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
	expect((await request("/tick", "POST")).status).toBe(400);
	expect(
		await (
			await request("/tick", "POST", {
				source: "cli",
			})
		).json(),
	).toEqual({ processed: false });
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
					readiness: answer("running", Object.keys(CLASSIFICATION)),
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

test("daemon ticks need no browser presence and cooldown saves use CAS", async () => {
	const { seedPull } = await import("../test/pr-fixture");
	const { addObservation } = await import("../monitoring/observations");
	seedProject(sqlite, { repositories: [] });
	seedPull(sqlite);
	const now = Math.floor(Date.now() / 1000);
	await addObservation(sqlite.db, "cli", { pullId: "pull-1" }, now);
	const schedule = async (source = "cli") =>
		(await (await request(`/schedule?source=${source}`)).json()) as {
			cooldownSeconds: number;
			projects: unknown[];
		};
	expect(await schedule()).toMatchObject({
		cooldownSeconds: 300,
		projects: [{ name: expect.any(String), requestCount: 0 }],
		pulls: [{ id: "pull-1", nextEligibleAt: null }],
	});
	expect((await schedule("demo")).projects).toEqual([]);
	expect((await request("/tick", "POST", { source: "cli" })).status).toBe(200);
	expect((await request("/tick", "POST", {})).status).toBe(400);
	expect((await request("/presence", "POST", {})).status).toBe(404);
	expect(
		(await request("/schedule", "PUT", { revision: 1, cooldownSeconds: 600 }))
			.status,
	).toBe(200);
	expect(
		(await request("/schedule", "PUT", { revision: 1, cooldownSeconds: 300 }))
			.status,
	).toBe(409);
	expect((await schedule()).cooldownSeconds).toBe(600);
	expect(
		(await request("/schedule", "PUT", { revision: 2, cooldownSeconds: 0 }))
			.status,
	).toBe(400);
	sqlite.raw
		.query(
			"INSERT OR REPLACE INTO ai_project_schedule(project_id,last_started_at,last_completed_at,request_count,input_tokens,output_tokens) VALUES('live-project',?,?,2,100,20)",
		)
		.run(now - 10, now);
	expect(await schedule()).toMatchObject({
		projects: [{ inputTokens: 100, requestCount: 2 }],
	});
});

test("editable common and project rules persist with CAS and isolate invalidations", async () => {
	seedProject(sqlite);
	const get = await request("/rules");
	const rules = (await get.json()) as {
		common: { revision: number; text: string };
		projects: { id: string; text: string }[];
	};
	expect(rules.common.text).toContain("Build failure means Attention");
	const put = (scope: string, revision: number, text: string) =>
		request("/rules", "PUT", { scope, revision, text });
	expect(
		(await put("common", 0, "Use these common instructions.")).status,
	).toBe(200);
	expect((await put("common", 0, "Stale")).status).toBe(409);
	expect((await put("missing-project", 0, "Private rules")).status).toBe(404);
	const projectId = rules.projects[0]!.id;
	expect((await put(projectId, 0, "Build expiry needs a person.")).status).toBe(
		200,
	);
	const saved = (await (await request("/rules")).json()) as typeof rules & {
		projects: { id: string; text: string }[];
	};
	expect(saved.common.text).toBe("Use these common instructions.");
	expect(saved.projects.find((p) => p.id === projectId)?.text).toBe(
		"Build expiry needs a person.",
	);
});
