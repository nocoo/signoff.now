import {
	collectionViewSchema,
	refreshSettingsSchema,
} from "@signoff/domain/collection";
import {
	type RefreshQueue,
	type RefreshQueueKind,
	refreshQueueKindSchema,
	refreshQueueSchema,
} from "@signoff/domain/workbench";
import type { Context } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import type { AppEnv } from "../types.js";

const ACTIVE = "'queued', 'running', 'auth_required'";
const VIEW_LEASE_SECONDS = 45;
const now = () => Math.floor(Date.now() / 1000);
export const REFRESH_QUEUES_SQL = `SELECT q.*,
 (SELECT COUNT(*) FROM collection_jobs j WHERE j.round_id = q.round_id) AS total_jobs,
 (SELECT COUNT(*) FROM collection_jobs j WHERE j.round_id = q.round_id AND j.state NOT IN (${ACTIVE})) AS completed_jobs
 FROM collection_refresh q ORDER BY q.kind DESC`;
type QueueRow = {
	kind: RefreshQueueKind;
	cooldown_seconds: RefreshQueue["cooldownSeconds"];
	last_completed_at: number | null;
	round_id: string | null;
	refresh_requested: number;
	foreground_until: number;
	total_jobs: number;
	completed_jobs: number;
};
export function mapRefreshQueue(row: QueueRow): RefreshQueue {
	return refreshQueueSchema.parse({
		kind: row.kind,
		cooldownSeconds: row.cooldown_seconds,
		lastCompletedAt: row.last_completed_at,
		roundId: row.round_id,
		requested: row.refresh_requested === 1,
		foregroundUntil: row.foreground_until,
		totalJobs: row.total_jobs,
		completedJobs: row.completed_jobs,
	});
}
async function queues(c: Context<AppEnv>) {
	const rows = await c.env.DB.prepare(REFRESH_QUEUES_SQL).all<QueueRow>();
	return rows.results.map(mapRefreshQueue);
}
function localOnly(c: Context<AppEnv>) {
	return isLocalhost(c.req.header("host") ?? "")
		? null
		: c.json(
				{ error: "Collection scheduling is only available on this machine" },
				403,
			);
}
async function body(c: Context<AppEnv>) {
	return readJsonBodyWithSize(c, 16384);
}
export async function refreshQueuesRoute(c: Context<AppEnv>) {
	const denied = localOnly(c);
	if (denied) return denied;
	c.header("Cache-Control", "no-store");
	return c.json(await queues(c));
}
export async function refreshSettingsRoute(c: Context<AppEnv>) {
	const denied = localOnly(c);
	if (denied) return denied;
	const raw = await body(c);
	const parsed = refreshSettingsSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json({ error: "Provide valid list and detail cooldowns" }, 400);
	const statements = (
		Object.entries({
			list: parsed.data.listCooldownSeconds,
			details: parsed.data.detailCooldownSeconds,
		}) as [RefreshQueueKind, number | undefined][]
	)
		.filter(
			(entry): entry is [RefreshQueueKind, number] => entry[1] !== undefined,
		)
		.map(([kind, seconds]) =>
			c.env.DB.prepare(`UPDATE collection_refresh SET
    refresh_requested = CASE WHEN cooldown_seconds = 0 AND ? > 0 AND round_id IS NULL THEN 1 ELSE refresh_requested END,
    cooldown_seconds = ? WHERE kind = ?`).bind(seconds, seconds, kind),
		);
	await c.env.DB.batch(statements);
	return c.json(await queues(c));
}
export async function collectionViewRoute(c: Context<AppEnv>) {
	const denied = localOnly(c);
	if (denied) return denied;
	const raw = await body(c);
	const parsed = collectionViewSchema.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json(
			{ error: "Provide a valid current page with at most 20 unique PRs" },
			400,
		);
	const view = parsed.data;
	const timestamp = now();
	const ids = JSON.stringify(view.pullIds);
	if (view.visible && view.pullIds.length) {
		const found =
			await c.env.DB.prepare(`SELECT pr.id FROM pull_requests pr INNER JOIN projects p ON p.id = pr.project_id
    WHERE pr.id IN (SELECT value FROM json_each(?)) AND p.enabled = 1 AND p.source = 'cli' AND p.provider = 'ado'`)
				.bind(ids)
				.all();
		if (found.results.length !== view.pullIds.length)
			return c.json({ error: "Select PRs from enabled live projects" }, 400);
	}
	// Every dependent write repeats the accepted-view guard. Late heartbeats cannot overwrite a newer page or hide event.
	const accepted =
		"((view_id = ? AND view_sequence < ?) OR (view_id != ? AND ? = 1 AND (? = 1 OR foreground_until <= ?)))";
	const viewGuard = [
		view.viewId,
		view.sequence,
		view.viewId,
		Number(view.visible),
		Number(view.refresh),
		timestamp,
	];
	await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE collection_jobs SET state = 'failed', message = 'Page changed; pending collection canceled', completed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
   WHERE kind = 'details' AND state IN ('queued', 'auth_required') AND round_id IN (
    SELECT round_id FROM collection_refresh WHERE kind = 'details' AND ? = 1 AND ${accepted} AND (view_id != ? OR page_key != ?)
   )`).bind(
			timestamp,
			timestamp,
			Number(view.visible),
			...viewGuard,
			view.viewId,
			view.pageKey,
		),
		c.env.DB.prepare(`UPDATE collection_refresh SET
    refresh_requested = CASE WHEN ? = 1 AND (view_id != ? OR page_key != ? OR ((? = 1 OR foreground_until <= ?) AND (round_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.round_id = collection_refresh.round_id AND j.state IN (${ACTIVE}))))) THEN 1 ELSE refresh_requested END,
    foreground_until = ?,
    page_key = CASE WHEN ? = 1 THEN ? ELSE page_key END,
    pull_ids_json = CASE WHEN ? = 1 THEN ? ELSE pull_ids_json END,
    view_id = ?, view_sequence = ?
   WHERE kind = 'details' AND ${accepted}`).bind(
			Number(view.visible),
			view.viewId,
			view.pageKey,
			Number(view.refresh),
			timestamp,
			view.visible ? timestamp + VIEW_LEASE_SECONDS : 0,
			Number(view.visible),
			view.pageKey,
			Number(view.visible),
			ids,
			view.viewId,
			view.sequence,
			...viewGuard,
		),
	]);
	return c.json(await queues(c));
}

/** Called by the local collector, so browser throttling never controls list discovery. */
export async function collectorScheduleRoute(c: Context<AppEnv>) {
	const denied = localOnly(c);
	if (denied) return denied;
	const raw = await body(c);
	const parsed = z
		.object({ kind: refreshQueueKindSchema })
		.strict()
		.safeParse(raw.ok ? raw.value : null);
	if (!parsed.success)
		return c.json({ error: "Choose the list or details queue" }, 400);
	const { kind } = parsed.data;
	const timestamp = now();
	const roundId = crypto.randomUUID();
	await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE collection_jobs SET state = 'failed', message = 'Project changed', completed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
   WHERE state IN (${ACTIVE}) AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = collection_jobs.project_id AND p.revision = collection_jobs.revision AND p.enabled = 1 AND p.source = 'cli'
   )`).bind(timestamp, timestamp),
		c.env.DB.prepare(`UPDATE collection_refresh SET last_completed_at = COALESCE((SELECT MAX(completed_at) FROM collection_jobs WHERE round_id = collection_refresh.round_id), ?), round_id = NULL
   WHERE round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.round_id = collection_refresh.round_id AND j.state IN (${ACTIVE}))`).bind(
			timestamp,
		),
		c.env.DB.prepare(`UPDATE collection_refresh SET round_id = ?, refresh_requested = 0
   WHERE kind = ? AND round_id IS NULL AND cooldown_seconds > 0
    AND (refresh_requested = 1 OR last_completed_at IS NULL OR last_completed_at + cooldown_seconds <= ?)
    AND (kind = 'list' OR foreground_until > ?)
    AND EXISTS (SELECT 1 FROM projects p WHERE p.source = 'cli' AND p.provider = 'ado' AND p.enabled = 1
      AND (? = 'list' OR EXISTS (SELECT 1 FROM pull_requests pr WHERE pr.project_id = p.id AND pr.id IN (SELECT value FROM json_each(collection_refresh.pull_ids_json)))))`).bind(
			roundId,
			kind,
			timestamp,
			timestamp,
			kind,
		),
		c.env.DB.prepare(`UPDATE collection_jobs SET round_id = ? WHERE kind = ? AND round_id IS NULL AND state IN (${ACTIVE})
    AND EXISTS (SELECT 1 FROM collection_refresh q WHERE q.kind = ? AND q.round_id = ? AND (q.kind = 'list' OR EXISTS (
      SELECT 1 FROM json_each(collection_jobs.pull_ids_json) requested WHERE requested.value IN (SELECT value FROM json_each(q.pull_ids_json)))))`).bind(
			roundId,
			kind,
			kind,
			roundId,
		),
		kind === "list"
			? c.env.DB.prepare(`INSERT INTO collection_jobs (id,project_id,revision,state,requested_at,updated_at,message,pull_ids_json,kind,round_id)
      SELECT lower(hex(randomblob(16))), p.id, p.revision, 'queued', ?, ?, 'Waiting to refresh PR list', '[]', 'list', ?
      FROM projects p WHERE p.enabled = 1 AND p.source = 'cli' AND p.provider = 'ado'
       AND EXISTS (SELECT 1 FROM collection_refresh WHERE kind = 'list' AND round_id = ?)
       AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.project_id = p.id AND j.kind = 'list' AND j.state IN (${ACTIVE}))
      ORDER BY p.created_at, p.id`).bind(timestamp, timestamp, roundId, roundId)
			: c.env.DB.prepare(`INSERT INTO collection_jobs (id,project_id,revision,state,requested_at,updated_at,message,pull_ids_json,kind,round_id)
      SELECT lower(hex(randomblob(16))), p.id, p.revision, 'queued', ?, ?, 'Waiting to refresh PR checks', json_array(pr.id), 'details', ?
      FROM collection_refresh q, json_each(q.pull_ids_json) selected INNER JOIN pull_requests pr ON pr.id = selected.value INNER JOIN projects p ON p.id = pr.project_id
      WHERE q.kind = 'details' AND q.round_id = ? AND p.enabled = 1 AND p.source = 'cli' AND p.provider = 'ado'
       AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.project_id = p.id AND j.kind = 'details' AND j.state IN (${ACTIVE}) AND pr.id IN (SELECT value FROM json_each(j.pull_ids_json)))
      ORDER BY CAST(selected.key AS INTEGER)`).bind(
					timestamp,
					timestamp,
					roundId,
					roundId,
				),
	]);
	const queue = (await queues(c)).find((candidate) => candidate.kind === kind);
	if (!queue) return c.json({ error: "Refresh settings are unavailable" }, 503);
	return c.json(queue);
}
