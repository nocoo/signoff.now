import { publicSource, storageSource } from "@signoff/domain/monitoring";
import {
	collectionMemberWriteSchema,
	prCollectionWriteSchema,
} from "@signoff/domain/pr-collections";
import { Hono } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

export const prCollectionRoutes = new Hono<AppEnv>();
prCollectionRoutes.onError((error, c) => {
	if (error.message.includes("UNIQUE constraint failed: pr_collections"))
		return c.json(
			{ error: "A collection with this name already exists." },
			409,
		);
	return apiError(error, c);
});
prCollectionRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});
const sourceOf = (value: string | undefined) =>
	storageSource(z.enum(["live", "sample"]).parse(value ?? "live"));
type Row = {
	id: string;
	source: "cli" | "demo";
	name: string;
	description: string;
	color: string;
	icon: string;
	revision: number;
	created_at: number;
	updated_at: number;
	total: number;
	open: number;
	draft: number;
	merged: number;
	closed: number;
};
const SELECT = `SELECT c.*,COUNT(pr.id) total,
  COALESCE(SUM(pr.state='open' AND json_extract(pr.snapshot,'$.draft')=0),0) open,
  COALESCE(SUM(pr.state='open' AND json_extract(pr.snapshot,'$.draft')=1),0) draft,
  COALESCE(SUM(pr.state='merged'),0) merged,COALESCE(SUM(pr.state='closed'),0) closed
  FROM pr_collections c LEFT JOIN pr_collection_members m ON m.collection_id=c.id
  LEFT JOIN pull_requests pr ON pr.id=m.pull_id`;
function output(row: Row) {
	return {
		id: row.id,
		source: publicSource(row.source),
		name: row.name,
		description: row.description,
		color: row.color,
		icon: row.icon,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		counts: {
			total: row.total,
			open: row.open,
			draft: row.draft,
			merged: row.merged,
			closed: row.closed,
		},
	};
}
async function read(db: D1Database, id: string, source: string) {
	const row = await db
		.prepare(`${SELECT} WHERE c.id=? AND c.source=? GROUP BY c.id`)
		.bind(id, source)
		.first<Row>();
	if (!row) throw new MonitoringError("NOT_FOUND", "Collection not found", 404);
	return output(row);
}
function checkChanged(changes: number | undefined) {
	if (!changes)
		throw new MonitoringError(
			"REVISION_CONFLICT",
			"Collection changed. Reload and try again.",
			409,
		);
}
prCollectionRoutes.get("/", async (c) => {
	const rows = await c.env.DB.prepare(
		`${SELECT} WHERE c.source=? GROUP BY c.id ORDER BY c.updated_at DESC,c.name COLLATE NOCASE,c.id`,
	)
		.bind(sourceOf(c.req.query("source")))
		.all<Row>();
	return c.json({ items: rows.results.map(output) });
});
prCollectionRoutes.get("/memberships", async (c) => {
	const ids = z
		.array(z.string().min(1).max(512))
		.max(200)
		.parse(c.req.queries("pullId") ?? []);
	const rows =
		await c.env.DB.prepare(`SELECT m.pull_id pullId,m.collection_id collectionId FROM pr_collection_members m
    JOIN pr_collections c ON c.id=m.collection_id WHERE c.source=? AND m.pull_id IN (SELECT value FROM json_each(?)) ORDER BY c.name COLLATE NOCASE,c.id`)
			.bind(sourceOf(c.req.query("source")), JSON.stringify(ids))
			.all();
	return c.json({ items: rows.results });
});
prCollectionRoutes.get("/:id", async (c) =>
	c.json(
		await read(c.env.DB, c.req.param("id"), sourceOf(c.req.query("source"))),
	),
);
prCollectionRoutes.post("/", async (c) => {
	const raw = await readJsonBodyWithSize(c, 8192);
	const input = prCollectionWriteSchema.parse(raw.ok ? raw.value : null);
	const id = crypto.randomUUID(),
		source = sourceOf(c.req.query("source"));
	await c.env.DB.prepare(
		"INSERT INTO pr_collections(id,source,name,description,color,icon,created_at,updated_at) VALUES(?,?,?,?,?,?,unixepoch(),unixepoch())",
	)
		.bind(id, source, input.name, input.description, input.color, input.icon)
		.run();
	return c.json(await read(c.env.DB, id, source), 201);
});
prCollectionRoutes.patch("/:id", async (c) => {
	const raw = await readJsonBodyWithSize(c, 8192);
	const input = prCollectionWriteSchema
		.extend({ revision: z.number().int().positive() })
		.parse(raw.ok ? raw.value : null);
	const id = c.req.param("id"),
		source = sourceOf(c.req.query("source"));
	await read(c.env.DB, id, source);
	const result = await c.env.DB.prepare(
		"UPDATE pr_collections SET name=?,description=?,color=?,icon=?,revision=revision+1,updated_at=unixepoch() WHERE id=? AND source=? AND revision=?",
	)
		.bind(
			input.name,
			input.description,
			input.color,
			input.icon,
			id,
			source,
			input.revision,
		)
		.run();
	checkChanged(result.meta.changes);
	return c.json(await read(c.env.DB, id, source));
});
prCollectionRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id"),
		source = sourceOf(c.req.query("source"));
	const revision = z.coerce
		.number()
		.int()
		.positive()
		.parse(c.req.query("revision"));
	await read(c.env.DB, id, source);
	const result = await c.env.DB.prepare(
		"DELETE FROM pr_collections WHERE id=? AND source=? AND revision=?",
	)
		.bind(id, source, revision)
		.run();
	checkChanged(result.meta.changes);
	return c.json({ deleted: true });
});
prCollectionRoutes.put("/:id/members", async (c) => {
	const raw = await readJsonBodyWithSize(c, 128000);
	const input = collectionMemberWriteSchema.parse(raw.ok ? raw.value : null);
	const id = c.req.param("id"),
		source = sourceOf(c.req.query("source")),
		db = c.env.DB;
	await read(db, id, source);
	const ids = JSON.stringify(input.pullIds);
	const valid = `(SELECT COUNT(*) FROM pull_requests pr JOIN projects p ON p.id=pr.project_id WHERE p.source=? AND pr.id IN (SELECT value FROM json_each(?)))=?`;
	const guard = `EXISTS(SELECT 1 FROM pr_collections WHERE id=? AND source=? AND revision=?) AND ${valid}`;
	const values = [
		id,
		source,
		input.revision,
		source,
		ids,
		input.pullIds.length,
	];
	const results = await db.batch([
		input.action === "add"
			? db
					.prepare(
						`INSERT INTO pr_collection_members(collection_id,pull_id,added_at) SELECT ?,value,unixepoch() FROM json_each(?) WHERE ${guard} ON CONFLICT DO NOTHING`,
					)
					.bind(id, ids, ...values)
			: db
					.prepare(
						`DELETE FROM pr_collection_members WHERE collection_id=? AND pull_id IN (SELECT value FROM json_each(?)) AND ${guard}`,
					)
					.bind(id, ids, ...values),
		db
			.prepare(
				`UPDATE pr_collections SET revision=revision+1,updated_at=unixepoch() WHERE id=? AND source=? AND revision=? AND ${valid}`,
			)
			.bind(...values),
	]);
	checkChanged(results[1]?.meta.changes);
	return c.json(await read(db, id, source));
});
