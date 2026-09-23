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
			.prepare(`WITH discovery_scopes AS (
		 SELECT p.id project_id,p.name project_name,p.source,p.revision,p.enabled,p.created_at,r.repository_id,r.name repository_name,
		 CASE WHEN r.repository_id IS NULL THEN '[]' ELSE json_array(lower(r.repository_id)) END scope_key
		 FROM projects p LEFT JOIN workbench_repositories r ON r.project_id=p.id WHERE p.source=? AND p.provider='ado'
		 UNION SELECT p.id,p.name,p.source,p.revision,p.enabled,p.created_at,json_extract(j.scope_json,'$[0]'),json_extract(j.scope_json,'$[0]'),j.scope_key
		 FROM projects p JOIN collection_jobs j ON j.project_id=p.id AND j.revision=p.revision AND j.kind='list' AND j.catalogue_only=0
		 WHERE p.source=? AND j.state IN ('queued','running','auth_required') AND NOT EXISTS (
		 SELECT 1 FROM workbench_repositories r WHERE r.project_id=p.id AND json_array(lower(r.repository_id))=j.scope_key)
	 ), discovery_groups AS (
		 SELECT s.*,'smart' depth FROM discovery_scopes s
		 UNION ALL SELECT s.*,'deep' FROM discovery_scopes s WHERE EXISTS (
		  SELECT 1 FROM collection_jobs j WHERE j.project_id=s.project_id AND j.scope_key=s.scope_key AND j.kind='list' AND j.discovery_depth='deep')
	 ), groups AS (
   SELECT 'pr:'||o.id id,'refresh' kind,o.project_id,COALESCE(p.name,o.project_id) project_name,o.ref_json,o.active,o.added_at created_at,
     (SELECT cooldown_seconds FROM collection_refresh WHERE kind='details') cooldown,
     (SELECT MAX(completed_at) FROM collection_jobs j WHERE j.observation_id=o.id AND j.observation_generation=o.generation AND j.summary_only=0) last_completed,
     (SELECT j.id FROM collection_jobs j WHERE j.source=o.source AND j.observation_id=o.id AND j.summary_only=0 ORDER BY requested_at DESC,id DESC LIMIT 1) job_id,
		 NULL repository_id,NULL repository_name,NULL depth
   FROM pr_observations o LEFT JOIN projects p ON p.id=o.project_id WHERE o.source=?
   UNION ALL
   SELECT 'repo:'||json_array(g.project_id,g.scope_key,g.depth),'discover',g.project_id,g.project_name,NULL,g.enabled,g.created_at,
     CASE WHEN g.depth='smart' THEN (SELECT cooldown_seconds FROM collection_refresh WHERE kind='list') ELSE 0 END,
     (SELECT MAX(completed_at) FROM collection_jobs j WHERE j.project_id=g.project_id AND j.revision=g.revision AND j.kind='list' AND j.scope_key=g.scope_key AND j.discovery_depth=g.depth),
     (SELECT j.id FROM collection_jobs j WHERE j.source=g.source AND j.project_id=g.project_id AND j.kind='list' AND j.scope_key=g.scope_key AND j.discovery_depth=g.depth ORDER BY requested_at DESC,id DESC LIMIT 1),
		 g.repository_id,g.repository_name,g.depth
   FROM discovery_groups g
 ) SELECT j.*,g.project_name,g.ref_json,g.active,g.created_at,g.cooldown,g.last_completed,g.job_id,g.id group_id,g.kind group_kind,g.project_id group_project_id,
 g.repository_id,g.repository_name,g.depth group_depth
 FROM groups g LEFT JOIN collection_jobs j ON j.id=g.job_id WHERE g.id>? ORDER BY g.id LIMIT 51`)
			.bind(source, source, source, cursor ?? "")
			.all<
				JobRow & {
					group_id: string;
					repository_id: string | null;
					repository_name: string | null;
					group_depth: "smart" | "deep" | null;
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
				depth: row.group_depth ?? undefined,
				repository: row.repository_id
					? {
							id: row.repository_id,
							name: row.repository_name ?? row.repository_id,
						}
					: null,
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
