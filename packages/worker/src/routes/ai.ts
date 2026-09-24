import {
	aiCooldownSchema,
	aiRuleWriteSchema,
	aiSettingsSchema,
	aiTickSchema,
	JEV_MODEL,
	JEV_RUBRIC,
} from "@signoff/domain/ai-readiness";
import { Hono } from "hono";
import { z } from "zod";
import { evaluateJev, JevError } from "../ai/jev.js";
import { readAiRules } from "../ai/rules.js";
import { readAiSchedule } from "../ai/schedule.js";
import { readAiSettings, runAiOnce } from "../ai/scheduler.js";
import { openKey, sealKey } from "../ai/secrets.js";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { hasLocalTrust } from "../middleware/entry-control.js";
import { measuredJevFetch } from "../monitoring/network.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";
export const aiRoutes = new Hono<AppEnv>();
aiRoutes.onError((error, c) =>
	error instanceof JevError
		? c.json({ error: error.message }, 400)
		: apiError(error, c),
);
aiRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	if (!hasLocalTrust(c))
		return c.json(
			{
				error:
					"AI configuration and evaluation are available on this machine only.",
			},
			403,
		);
	const origin = c.req.header("origin");
	if (
		origin &&
		(!URL.canParse(origin) || new URL(origin).host !== c.req.header("host")) &&
		![
			"https://signoff.dev.hexly.ai",
			"http://localhost:7042",
			"http://127.0.0.1:7042",
		].includes(origin)
	)
		return c.json({ error: "Cross-origin AI requests are not allowed." }, 403);
	await next();
});
aiRoutes.get("/settings", async (c) => {
	const row = await readAiSettings(c.env.DB);
	return c.json(
		aiSettingsSchema.parse({
			configured: Boolean(row.encrypted_key),
			storageReady: Boolean(c.env.SIGNOFF_AI_ENCRYPTION_KEY),
			revision: row.revision,
			testedAt: row.tested_at
				? new Date(row.tested_at * 1000).toISOString()
				: null,
			testState: row.test_state,
			testError: row.test_error,
			model: JEV_MODEL,
			rubric: JEV_RUBRIC,
		}),
	);
});
aiRoutes.put("/settings", async (c) => {
	const body = await readJsonBodyWithSize(c, 8192);
	const input = z
		.object({
			revision: z.number().int().positive(),
			apiKey: z.string().trim().min(1).max(4096).nullable(),
		})
		.strict()
		.parse(body.ok ? body.value : null);
	const encrypted =
		input.apiKey === null
			? null
			: await sealKey(input.apiKey, c.env.SIGNOFF_AI_ENCRYPTION_KEY);
	const result = await c.env.DB.prepare(
		"UPDATE ai_settings SET encrypted_key=?,revision=revision+1,tested_at=NULL,test_state='untested',test_error=NULL WHERE id=1 AND revision=?",
	)
		.bind(encrypted, input.revision)
		.run();
	return result.meta.changes
		? c.json({ saved: true })
		: c.json({ error: "AI Settings changed. Reload before saving." }, 409);
});
aiRoutes.post("/test", async (c) => {
	const row = await readAiSettings(c.env.DB);
	let message: string | null = null;
	try {
		const key = await openKey(
			row.encrypted_key,
			c.env.SIGNOFF_AI_ENCRYPTION_KEY,
		);
		await evaluateJev(
			key,
			{
				connectionTest: true,
				pr: { lifecycle: "open" },
				evidence:
					"Synthetic connection test only. No PR facts provided; Running means awaiting evidence.",
			},
			"connection-test",
			Math.floor(Date.now() / 1000),
			measuredJevFetch(c.env.DB),
		);
	} catch (error) {
		message =
			error instanceof JevError ? error.message : "Jev connection test failed.";
	}
	const written = await c.env.DB.prepare(
		"UPDATE ai_settings SET tested_at=?,test_state=?,test_error=? WHERE id=1 AND revision=?",
	)
		.bind(
			Math.floor(Date.now() / 1000),
			message ? "error" : "valid",
			message,
			row.revision,
		)
		.run();
	if (!written.meta.changes)
		return c.json(
			{ error: "The key changed during the test. Test the current key again." },
			409,
		);
	return message
		? c.json({ error: message }, 400)
		: c.json({ tested: true, model: JEV_MODEL });
});
aiRoutes.post("/tick", async (c) => {
	const body = await readJsonBodyWithSize(c, 2048);
	const input = aiTickSchema.parse(body.ok ? body.value : null);
	return c.json(await runAiOnce(c.env, input.source));
});
aiRoutes.post("/retry", async (c) => {
	await c.env.DB.prepare(
		"UPDATE ai_evaluations SET status='pending',attempts=0,not_before=0,input_revision=input_revision+1,error=NULL WHERE status='error'",
	).run();
	return c.json({ scheduled: true });
});

aiRoutes.get("/schedule", async (c) =>
	c.json(
		await readAiSchedule(
			c.env.DB,
			z.enum(["cli", "demo"]).parse(c.req.query("source") ?? "cli"),
		),
	),
);
aiRoutes.put("/schedule", async (c) => {
	const body = await readJsonBodyWithSize(c, 2048);
	const input = z
		.object({
			revision: z.number().int().positive(),
			cooldownSeconds: aiCooldownSchema,
		})
		.strict()
		.parse(body.ok ? body.value : null);
	const result = await c.env.DB.prepare(
		"UPDATE ai_settings SET cooldown_seconds=?,schedule_revision=schedule_revision+1 WHERE id=1 AND schedule_revision=?",
	)
		.bind(input.cooldownSeconds, input.revision)
		.run();
	return result.meta.changes
		? c.json({ saved: true })
		: c.json({ error: "AI cooldown changed. Reload before saving." }, 409);
});

aiRoutes.get("/rules", async (c) => c.json(await readAiRules(c.env.DB)));
aiRoutes.put("/rules", async (c) => {
	const body = await readJsonBodyWithSize(c, 64000);
	const input = aiRuleWriteSchema.parse(body.ok ? body.value : null);
	if (
		input.scope !== "common" &&
		!(await c.env.DB.prepare(
			"SELECT id FROM projects WHERE id=? AND source='cli'",
		)
			.bind(input.scope)
			.first())
	)
		return c.json({ error: "Project not found." }, 404);
	const result =
		input.revision === 0
			? await c.env.DB.prepare(
					"INSERT INTO ai_rules(scope,revision,text) VALUES(?,1,?) ON CONFLICT DO NOTHING",
				)
					.bind(input.scope, input.text)
					.run()
			: await c.env.DB.prepare(
					"UPDATE ai_rules SET revision=revision+1,text=? WHERE scope=? AND revision=?",
				)
					.bind(input.text, input.scope, input.revision)
					.run();
	return result.meta.changes
		? c.json({ saved: true })
		: c.json({ error: "Rules changed. Reload before saving." }, 409);
});
