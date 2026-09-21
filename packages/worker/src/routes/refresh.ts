import { refreshSettingsSchema } from "@signoff/domain/collection";
import {
	collectionLaneSchema,
	type RefreshQueue,
	refreshQueueKindSchema,
	refreshQueueSchema,
} from "@signoff/domain/workbench";
import type { Context } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import {
	scheduleDiscovery,
	scheduleObservations,
} from "../monitoring/scheduler.js";
import type { AppEnv } from "../types.js";

export const REFRESH_QUEUES_SQL = `SELECT q.kind,q.cooldown_seconds,
 (SELECT MAX(completed_at) FROM collection_jobs WHERE kind=q.kind AND summary_only=0) AS last_completed_at,
 NULL AS round_id,
 0 AS refresh_requested,9007199254740991 AS foreground_until,
 (SELECT COUNT(*) FROM collection_jobs j WHERE j.kind=q.kind AND j.summary_only=0 AND j.state IN ('queued','running','auth_required')) AS total_jobs,
 0 AS completed_jobs
 FROM collection_refresh q ORDER BY q.kind DESC`;
type QueueRow = {
	kind: RefreshQueue["kind"];
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
	return (
		await c.env.DB.prepare(REFRESH_QUEUES_SQL).all<QueueRow>()
	).results.map(mapRefreshQueue);
}
function localOnly(c: Context<AppEnv>) {
	return isLocalhost(c.req.header("host") ?? "")
		? null
		: c.json(
				{ error: "Collection scheduling is only available on this machine" },
				403,
			);
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
	const raw = await readJsonBodyWithSize(c, 8192);
	const input = refreshSettingsSchema.safeParse(raw.ok ? raw.value : null);
	if (!input.success)
		return c.json({ error: "Invalid collector cooldown settings" }, 400);
	const settings = [
		["list", input.data.listCooldownSeconds],
		["details", input.data.detailCooldownSeconds],
	] as const;
	await c.env.DB.batch(
		settings.flatMap(([kind, value]) =>
			value === undefined
				? []
				: [
						c.env.DB.prepare(
							"UPDATE collection_refresh SET cooldown_seconds=? WHERE kind=?",
						).bind(value, kind),
						c.env.DB.prepare(`UPDATE collection_jobs SET not_before=MAX(requested_at,COALESCE((
 SELECT MAX(previous.completed_at)+? FROM collection_jobs previous
 WHERE previous.id<>collection_jobs.id AND previous.summary_only=0
 AND previous.project_id=collection_jobs.project_id AND previous.revision=collection_jobs.revision AND previous.kind=collection_jobs.kind
 AND (collection_jobs.kind='list' OR (previous.observation_id=collection_jobs.observation_id AND previous.observation_generation=collection_jobs.observation_generation))
 ),requested_at)) WHERE kind=? AND state='queued' AND summary_only=0`).bind(
							value,
							kind,
						),
					],
		),
	);
	return c.json(await queues(c));
}
/** Compatibility tombstone: a page can never schedule provider work. */
export async function collectionViewRoute(c: Context<AppEnv>) {
	return c.json(
		{
			error:
				"Page-based collection was removed. Add PRs to the shared watch list.",
		},
		410,
	);
}
export async function collectorScheduleRoute(c: Context<AppEnv>) {
	const denied = localOnly(c);
	if (denied) return denied;
	const raw = await readJsonBodyWithSize(c, 8192);
	const input = z
		.object({
			kind: refreshQueueKindSchema.optional(),
			lane: collectionLaneSchema.optional(),
		})
		.strict()
		.safeParse(raw.ok ? raw.value : null);
	if (!input.success) return c.json({ error: "Invalid schedule request" }, 400);
	await (input.data.kind === "list" || input.data.lane === "discover"
		? scheduleDiscovery
		: scheduleObservations)(
		c.env.DB,
		Math.floor(Date.now() / 1000),
		c.env.SIGNOFF_DEMO_MODE === "1" ? undefined : "cli",
	);
	const result = await queues(c);
	return c.json(
		input.data.kind ? result.find((q) => q.kind === input.data.kind) : result,
	);
}
