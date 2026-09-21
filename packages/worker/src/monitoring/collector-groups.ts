import type { DataSource } from "@signoff/domain/monitoring";
import { collectorGroupsSchema } from "@signoff/domain/query";
import { publicJob } from "./query.js";
import type { JobRow } from "./store.js";

export async function queryCollectorGroups(
	db: D1Database,
	source: DataSource,
	cursor: string | undefined,
	timestamp: number,
) {
	const rows = (
		await db
			.prepare(`WITH groups AS (
   SELECT 'pr:'||o.id id,'refresh' kind,o.project_id,COALESCE(p.name,o.project_id) project_name,o.ref_json,o.active,o.added_at created_at,
     (SELECT cooldown_seconds FROM collection_refresh WHERE kind='details') cooldown,
     (SELECT MAX(completed_at) FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=0) last_completed,
     (SELECT j.id FROM collection_jobs j WHERE j.source=o.source AND j.observation_id=o.id AND j.summary_only=0 ORDER BY requested_at DESC,id DESC LIMIT 1) job_id
   FROM pr_observations o LEFT JOIN projects p ON p.id=o.project_id WHERE o.source=?
   UNION ALL
   SELECT 'project:'||p.id,'discover',p.id,p.name,NULL,p.enabled,p.created_at,
     (SELECT cooldown_seconds FROM collection_refresh WHERE kind='list'),
     (SELECT MAX(completed_at) FROM collection_jobs j WHERE j.project_id=p.id AND j.revision=p.revision AND j.kind='list'),
     (SELECT j.id FROM collection_jobs j WHERE j.source=p.source AND j.project_id=p.id AND j.kind='list' ORDER BY requested_at DESC,id DESC LIMIT 1)
   FROM projects p WHERE p.source=? AND p.provider='ado'
 ) SELECT j.*,g.project_name,g.ref_json,g.active,g.created_at,g.cooldown,g.last_completed,g.job_id,g.id group_id,g.kind group_kind,g.project_id group_project_id
 FROM groups g LEFT JOIN collection_jobs j ON j.id=g.job_id WHERE g.id>? ORDER BY g.id LIMIT 51`)
			.bind(source, source, cursor ?? "")
			.all<
				JobRow & {
					group_id: string;
					group_kind: "refresh" | "discover";
					group_project_id: string;
					project_name: string;
					ref_json: string | null;
					active: number;
					created_at: number;
					cooldown: number;
					last_completed: number | null;
					job_id: string | null;
				}
			>()
	).results;
	const page = rows.slice(0, 50);
	const iso = (value: number | null) =>
		value === null ? null : new Date(value * 1000).toISOString();
	return collectorGroupsSchema.parse({
		generatedAt: iso(timestamp),
		nextCursor: rows.length > 50 ? page[page.length - 1]?.group_id : null,
		data: page.map((row) => {
			const latest = row.job_id
				? {
						...publicJob(
							{
								...row,
								id: row.job_id,
								kind: row.group_kind === "discover" ? "list" : "details",
							},
							[],
						),
						projectName: row.project_name,
					}
				: null;
			const busy =
				latest && ["queued", "running", "auth_required"].includes(latest.state);
			const due =
				row.active && row.cooldown
					? row.last_completed === null
						? row.created_at
						: row.last_completed + row.cooldown
					: null;
			const next = busy
				? latest.state === "running"
					? null
					: Math.max(Date.parse(latest.notBefore) / 1000, due ?? 0)
				: due;
			return {
				id: row.group_id,
				kind: row.group_kind,
				projectId: row.group_project_id,
				projectName: row.project_name,
				target: row.ref_json ? JSON.parse(row.ref_json) : null,
				active: Boolean(row.active),
				cooldownSeconds: row.cooldown,
				lastCompletedAt: iso(row.last_completed),
				nextRunAt: iso(next),
				latest,
			};
		}),
	});
}
