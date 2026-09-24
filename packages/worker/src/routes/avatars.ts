import {
	AVATAR_MAX_BYTES,
	AVATAR_REFRESH_SECONDS,
	type AvatarTask,
	avatarContentTypeSchema,
	avatarTaskSchema,
	isAdoAvatarUrl,
} from "@signoff/domain/avatars";
import { Hono } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import type { AppEnv } from "../types.js";

export const avatarRoutes = new Hono<AppEnv>();
avatarRoutes.get("/", async (c) => {
	c.header("Cache-Control", "no-store");
	const input = z
		.object({
			source: z.enum(["live", "sample"]),
			url: z.string().url().max(2048),
		})
		.safeParse(c.req.query());
	if (!input.success) return c.json({ error: "Invalid avatar query" }, 400);
	const cached = await c.env.DB.prepare(
		"SELECT body,content_type,etag FROM avatar_cache WHERE source=? AND url=? AND body IS NOT NULL",
	)
		.bind(input.data.source === "live" ? "cli" : "demo", input.data.url)
		.first<{
			body: ArrayBuffer | number[];
			content_type: string;
			etag: string;
		}>();
	if (!cached) return c.body(null, 404);
	c.header("Cache-Control", "private, max-age=3600");
	c.header("ETag", cached.etag);
	c.header("X-Content-Type-Options", "nosniff");
	if (c.req.header("if-none-match") === cached.etag) return c.body(null, 304);
	c.header("Content-Type", cached.content_type);
	return c.body(new Uint8Array(cached.body));
});

export async function claimAvatars(
	db: D1Database,
	now: number,
): Promise<AvatarTask[]> {
	const candidates = (
		await db
			.prepare(
				"SELECT source,url,organization FROM avatar_cache WHERE source='cli' AND due_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY due_at,url LIMIT 4",
			)
			.bind(now, now)
			.all<{ source: "cli"; url: string; organization: string }>()
	).results;
	const tasks: AvatarTask[] = [];
	for (const row of candidates) {
		if (!isAdoAvatarUrl(row.url, row.organization)) {
			await db
				.prepare(
					"DELETE FROM avatar_cache WHERE source=? AND url=? AND body IS NULL",
				)
				.bind(row.source, row.url)
				.run();
			continue;
		}
		const leaseToken = crypto.randomUUID();
		const result = await db
			.prepare(
				"UPDATE avatar_cache SET lease_token=?,lease_expires_at=? WHERE source=? AND url=? AND due_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
			)
			.bind(leaseToken, now + 900, row.source, row.url, now, now)
			.run();
		if (result.meta.changes) tasks.push({ ...row, leaseToken });
	}
	return tasks;
}

export const collectorAvatarRoutes = new Hono<AppEnv>();
collectorAvatarRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	return next();
});
collectorAvatarRoutes.post("/claim", async (c) =>
	c.json(await claimAvatars(c.env.DB, Math.floor(Date.now() / 1000))),
);
const publishSchema = avatarTaskSchema.extend({
	contentType: avatarContentTypeSchema,
	base64: z
		.string()
		.min(4)
		.max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4)
		.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
collectorAvatarRoutes.post("/publish", async (c) => {
	const raw = await readJsonBodyWithSize(c, 360 * 1024);
	if (!raw.ok)
		return c.json(
			{ error: "Invalid avatar body" },
			raw.error === "payload_too_large" ? 413 : 400,
		);
	const parsed = publishSchema.safeParse(raw.value);
	if (!parsed.success) return c.json({ error: "Invalid avatar body" }, 400);
	const input = parsed.data;
	if (!isAdoAvatarUrl(input.url, input.organization))
		return c.json({ error: "Invalid avatar source" }, 400);
	const bytes = Uint8Array.from(atob(input.base64), (character) =>
		character.charCodeAt(0),
	);
	if (!bytes.length || bytes.length > AVATAR_MAX_BYTES)
		return c.json({ error: "Invalid avatar size" }, 400);
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	const etag = `"${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
	const now = Math.floor(Date.now() / 1000);
	const updated = await c.env.DB.prepare(
		"UPDATE avatar_cache SET body=?,content_type=?,etag=?,fetched_at=?,due_at=?,lease_token=NULL,lease_expires_at=NULL WHERE source=? AND url=? AND organization=? AND lease_token=? AND lease_expires_at>?",
	)
		.bind(
			bytes.buffer,
			input.contentType,
			etag,
			now,
			now + AVATAR_REFRESH_SECONDS,
			input.source,
			input.url,
			input.organization,
			input.leaseToken,
			now,
		)
		.run();
	return c.json(
		{ published: updated.meta.changes > 0 },
		updated.meta.changes ? 200 : 409,
	);
});
collectorAvatarRoutes.post("/fail", async (c) => {
	const raw = await readJsonBodyWithSize(c, 4096);
	if (!raw.ok) return c.json({ error: "Invalid avatar body" }, 400);
	const parsed = avatarTaskSchema.safeParse(raw.value);
	if (!parsed.success) return c.json({ error: "Invalid avatar body" }, 400);
	const input = parsed.data;
	const now = Math.floor(Date.now() / 1000);
	const result = await c.env.DB.prepare(
		"UPDATE avatar_cache SET due_at=?,lease_token=NULL,lease_expires_at=NULL WHERE source=? AND url=? AND organization=? AND lease_token=? AND lease_expires_at>?",
	)
		.bind(
			now + 3600,
			input.source,
			input.url,
			input.organization,
			input.leaseToken,
			now,
		)
		.run();
	return c.json(
		{ recorded: result.meta.changes > 0 },
		result.meta.changes ? 200 : 409,
	);
});
