/**
 * Read-only Activity heatmap / timeline (06 §7 / 05 §8).
 */

import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { loadSettings } from "./settings.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDevs(raw: string | undefined): string[] | null {
	if (!raw || raw.trim().length === 0) {
		return null;
	}
	const ids = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (ids.length < 1 || ids.length > 20) {
		return null;
	}
	return ids;
}

function daySpanOk(from: string, to: string, maxDays: number): boolean {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
		return false;
	}
	const days = (b - a) / (86400 * 1000) + 1;
	return days <= maxDays;
}

/** GET /api/activity/heatmap */
export async function activityHeatmapRoute(c: Context<AppEnv>) {
	const settings = await loadSettings(c.env.DB);
	const q = c.req.query();
	const devs = parseDevs(q.devs);
	const from = q.from ?? "";
	const to = q.to ?? "";
	if (
		!devs ||
		!DATE_RE.test(from) ||
		!DATE_RE.test(to) ||
		!daySpanOk(from, to, 366)
	) {
		return c.json({ error: "Invalid query: devs, from, to" }, 400);
	}

	if (settings.scoresStale) {
		return c.json({
			pipelineConfigVersion: settings.pipelineConfigVersion,
			scoresStale: true,
			staleReason: settings.scoresStaleReason,
			rows: [],
		});
	}

	const placeholders = devs.map(() => "?").join(",");
	const res = await c.env.DB.prepare(
		`SELECT developer_id, day_key, total, activity_count
     FROM scores
     WHERE developer_id IN (${placeholders})
       AND day_key BETWEEN ? AND ?
       AND config_version = ?`,
	)
		.bind(...devs, from, to, settings.pipelineConfigVersion)
		.all<{
			developer_id: string;
			day_key: string;
			total: number;
			activity_count: number;
		}>();

	return c.json({
		pipelineConfigVersion: settings.pipelineConfigVersion,
		scoresStale: false,
		staleReason: null,
		rows: (res.results ?? []).map((r) => ({
			developerId: r.developer_id,
			dayKey: r.day_key,
			total: r.total,
			activityCount: r.activity_count,
		})),
	});
}

/** GET /api/activity/timeline */
export async function activityTimelineRoute(c: Context<AppEnv>) {
	const settings = await loadSettings(c.env.DB);
	const q = c.req.query();
	const dev = q.dev?.trim() ?? "";
	const from = q.from ?? "";
	const to = q.to ?? "";
	const limitRaw = Number(q.limit ?? "100");
	const limit =
		Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200
			? limitRaw
			: 100;

	if (
		!dev ||
		!DATE_RE.test(from) ||
		!DATE_RE.test(to) ||
		!daySpanOk(from, to, 90)
	) {
		return c.json({ error: "Invalid query: dev, from, to" }, 400);
	}

	if (settings.scoresStale) {
		return c.json({
			pipelineConfigVersion: settings.pipelineConfigVersion,
			scoresStale: true,
			staleReason: settings.scoresStaleReason,
			items: [],
			nextCursor: null,
		});
	}

	// Optional keyset cursor: base64url of `${occurredAt}:${id}`
	let cursorOccurred: number | null = null;
	let cursorId: string | null = null;
	if (q.cursor) {
		try {
			const decoded = atob(q.cursor);
			const [o, id] = decoded.split(":");
			cursorOccurred = Number(o);
			cursorId = id ?? null;
			if (!Number.isFinite(cursorOccurred) || !cursorId) {
				return c.json({ error: "Invalid cursor" }, 400);
			}
		} catch {
			return c.json({ error: "Invalid cursor" }, 400);
		}
	}

	// Date window is settings-timezone day_key semantics (05 §8 / 06), not UTC epoch bounds.
	let sql = `SELECT id, type, occurred_at, day_key, org, project, repo_id, meta_json
    FROM activities
    WHERE developer_id = ?
      AND config_version = ?
      AND day_key BETWEEN ? AND ?`;
	const binds: unknown[] = [dev, settings.pipelineConfigVersion, from, to];
	if (cursorOccurred !== null && cursorId) {
		sql += ` AND (occurred_at < ? OR (occurred_at = ? AND id < ?))`;
		binds.push(cursorOccurred, cursorOccurred, cursorId);
	}
	sql += ` ORDER BY occurred_at DESC, id DESC LIMIT ?`;
	binds.push(limit + 1);

	const res = await c.env.DB.prepare(sql)
		.bind(...binds)
		.all<{
			id: string;
			type: string;
			occurred_at: number;
			day_key: string;
			org: string;
			project: string;
			repo_id: string | null;
			meta_json: string | null;
		}>();

	const rows = res.results ?? [];
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last ? btoa(`${last.occurred_at}:${last.id}`) : null;

	return c.json({
		pipelineConfigVersion: settings.pipelineConfigVersion,
		scoresStale: false,
		staleReason: null,
		items: page.map((r) => ({
			id: r.id,
			type: r.type,
			occurredAt: r.occurred_at,
			dayKey: r.day_key,
			org: r.org,
			project: r.project,
			repoId: r.repo_id,
			meta: r.meta_json ? (JSON.parse(r.meta_json) as unknown) : {},
		})),
		nextCursor,
	});
}
