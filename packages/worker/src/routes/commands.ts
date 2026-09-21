import { querySourceSchema, storageSource } from "@signoff/domain/monitoring";
import type { Project } from "@signoff/domain/workbench";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import {
	addObservation,
	enqueueDiscovery,
	refreshObserved,
	removeObservation,
	resolveRepository,
} from "../monitoring/observations.js";
import { publicObservation } from "../monitoring/query.js";
import { MonitoringError, readProject } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

const sourceSchema = querySourceSchema.default("live");
const referenceSchema = z.union([
	z.object({ pullId: z.string().min(1).max(240) }).strict(),
	z.object({ url: z.url().max(4096) }).strict(),
]);
const removeItem = z
	.object({
		id: z.string().min(1).max(240),
		generation: z.number().int().positive(),
	})
	.strict();
const addSchema = z
	.object({
		source: sourceSchema,
		refs: z.array(referenceSchema).min(1).max(100),
	})
	.strict();
const removeSchema = z
	.object({ source: sourceSchema, items: z.array(removeItem).min(1).max(100) })
	.strict();
const discoverSchema = z.union([
	z
		.object({
			source: sourceSchema,
			repositoryUrl: z.url().max(4096),
		})
		.strict(),
	z
		.object({
			source: sourceSchema,
			projectId: z.string().min(1).max(240),
		})
		.strict(),
]);
const refreshSchema = z
	.object({
		source: sourceSchema,
		target: z.union([
			referenceSchema,
			z.object({ repositoryUrl: z.url().max(4096) }).strict(),
			z.object({ all: z.literal(true) }).strict(),
		]),
	})
	.strict();
const now = () => Math.floor(Date.now() / 1000);
async function body(c: Context<AppEnv>) {
	const raw = await readJsonBodyWithSize(c, 512 * 1024);
	if (!raw.ok)
		throw new MonitoringError(
			"INVALID_ARGUMENT",
			raw.error === "payload_too_large"
				? "Command body is too large"
				: "Invalid JSON body",
			raw.error === "payload_too_large" ? 413 : 400,
		);
	return raw.value;
}
function writableSource(c: Context<AppEnv>, value: "live" | "sample") {
	if (
		value === "sample" &&
		!(
			c.env.SIGNOFF_DEMO_MODE === "1" && isLocalhost(c.req.header("host") ?? "")
		)
	)
		throw new MonitoringError(
			"SAMPLE_READ_ONLY",
			"Sample commands are only available in local demo mode",
			403,
		);
	return storageSource(value);
}
export const commandRoutes = new Hono<AppEnv>();
commandRoutes.onError(apiError);
commandRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});
commandRoutes.post("/observations", async (c) => {
	const input = addSchema.parse(await body(c));
	const source = writableSource(c, input.source);
	const results = [];
	for (const ref of input.refs) {
		try {
			const result = await addObservation(c.env.DB, source, ref, now());
			results.push({
				...result,
				observation: publicObservation(result.observation),
			});
		} catch (error) {
			if (
				!(
					error instanceof MonitoringError ||
					error instanceof TypeError ||
					error instanceof z.ZodError
				)
			)
				throw error;
			results.push({
				status: "rejected",
				error: {
					code:
						error instanceof MonitoringError ? error.code : "INVALID_REFERENCE",
					message: error.message,
					retryable: false,
				},
			});
		}
	}
	return c.json({ results });
});
commandRoutes.post("/observations/remove", async (c) => {
	const input = removeSchema.parse(await body(c));
	const source = writableSource(c, input.source);
	const results = [];
	for (const item of input.items) {
		const r = await removeObservation(
			c.env.DB,
			source,
			item.id,
			item.generation,
			now(),
		);
		results.push({
			...r,
			observation: r.observation ? publicObservation(r.observation) : null,
		});
	}
	return c.json({ results });
});
commandRoutes.delete("/observations/:id", async (c) => {
	const source = writableSource(
		c,
		querySourceSchema.parse(c.req.query("source") ?? "live"),
	);
	const version = /^"([1-9]\d*)"$/.exec(c.req.header("if-match") ?? "");
	if (!version || !Number.isSafeInteger(Number(version[1])))
		throw new MonitoringError(
			"INVALID_ARGUMENT",
			"Provide If-Match with the observed generation",
		);
	const result = await removeObservation(
		c.env.DB,
		source,
		c.req.param("id"),
		Number(version[1]),
		now(),
	);
	return c.json(
		{
			...result,
			observation: result.observation
				? publicObservation(result.observation)
				: null,
		},
		result.status === "conflict"
			? 409
			: result.status === "not_found"
				? 404
				: 200,
	);
});
commandRoutes.post("/discover", async (c) => {
	const input = discoverSchema.parse(await body(c));
	const source = writableSource(c, input.source);
	let project: Project | null;
	let scope: string[];
	if ("repositoryUrl" in input) {
		const resolved = await resolveRepository(
			c.env.DB,
			source,
			input.repositoryUrl,
		);
		project = resolved.project;
		scope = [
			resolved.repository?.repository_id ?? resolved.reference.repository,
		];
	} else {
		project = await readProject(c.env.DB, input.projectId);
		if (!project || project.source !== source)
			throw new MonitoringError(
				"REPOSITORY_NOT_TRACKED",
				"Project is not registered in this source",
				404,
			);
		scope = project.repositories ?? [];
	}
	return c.json(
		{
			jobs: [await enqueueDiscovery(c.env.DB, project, scope, now())],
		},
		202,
	);
});
commandRoutes.post("/refresh", async (c) => {
	const input = refreshSchema.parse(await body(c));
	return c.json(
		await refreshObserved(
			c.env.DB,
			writableSource(c, input.source),
			input.target,
			now(),
		),
		202,
	);
});
