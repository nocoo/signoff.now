import { querySourceSchema, storageSource } from "@signoff/domain/monitoring";
import { machinePullPageSchema } from "@signoff/domain/query";
import type { Context } from "hono";
import { z } from "zod";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";

const PAGE_SIZE = 20;
const cursorSchema = z.object({
	scope: z.string(),
	number: z.number().int().positive(),
	id: z.string().min(1).max(1024),
});
const querySchema = z.object({
	source: querySourceSchema.default("live"),
	repositoryId: z.string().max(240).default(""),
	q: z.string().trim().max(1000).default(""),
	watched: z.enum(["true", "false"]).default("true"),
	cursor: z.string().max(8192).optional(),
});

/** Lightweight keyset pages: changing observation clocks never resets scrolling. */
export async function readMachinePulls(c: Context<AppEnv>) {
	const projectId = z.string().min(1).max(240).parse(c.req.param("id"));
	const input = querySchema.parse(c.req.query());
	const source = storageSource(input.source);
	const search = input.q.replace(/^#/, "").toLowerCase();
	const scope = JSON.stringify([
		source,
		projectId,
		input.repositoryId,
		search,
		input.watched,
	]);
	let cursor: z.infer<typeof cursorSchema> | null = null;
	if (input.cursor) {
		try {
			cursor = cursorSchema.parse(JSON.parse(input.cursor));
			if (cursor.scope !== scope) throw new Error("Scope changed");
		} catch {
			throw new MonitoringError(
				"INVALID_CURSOR",
				"PR cursor does not match this query",
			);
		}
	}
	const results = await c.env.DB.batch([
		c.env.DB.prepare("SELECT id FROM projects WHERE id=? AND source=?").bind(
			projectId,
			source,
		),
		c.env.DB.prepare(`WITH choices AS (
      SELECT pr.id,json_extract(pr.snapshot,'$.number') number,json_extract(pr.snapshot,'$.title') title,
        EXISTS(SELECT 1 FROM pr_observations o WHERE o.pull_id=pr.id AND o.active=1 AND o.source=?) watched
      FROM pull_requests pr JOIN projects p ON p.id=pr.project_id
      WHERE p.id=? AND p.source=? AND (?='' OR pr.repository_id=?)
    ) SELECT id,number,title,watched FROM choices
    WHERE (?=0 OR watched=1)
      AND (?='' OR instr(lower(title),?)>0 OR instr(CAST(number AS TEXT),?)>0)
      AND (? IS NULL OR number<? OR (number=? AND id>?))
    ORDER BY number DESC,id ASC LIMIT ?`).bind(
			source,
			projectId,
			source,
			input.repositoryId,
			input.repositoryId,
			Number(input.watched === "true"),
			search,
			search,
			search,
			cursor?.number ?? null,
			cursor?.number ?? null,
			cursor?.number ?? null,
			cursor?.id ?? null,
			PAGE_SIZE + 1,
		),
	]);
	if (!results[0]?.results.length)
		throw new MonitoringError(
			"PROJECT_NOT_FOUND",
			"Project not found in this data source",
			404,
		);
	const rows = results[1]?.results as {
		id: string;
		number: number;
		title: string;
		watched: number;
	}[];
	const data = rows
		.slice(0, PAGE_SIZE)
		.map((row) => ({ ...row, watched: row.watched === 1 }));
	const last = data.at(-1);
	return c.json(
		machinePullPageSchema.parse({
			data,
			nextCursor:
				rows.length > PAGE_SIZE && last
					? JSON.stringify({ scope, number: last.number, id: last.id })
					: null,
		}),
	);
}
