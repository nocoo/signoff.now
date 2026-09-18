import {
	collectionBatchSchema,
	collectionDoneSchema,
	collectionFailureSchema,
	collectionProgressSchema,
	collectionPublishSchema,
	collectionRepositoriesSchema,
	collectionRepositoryFailureSchema,
	collectorHeartbeatSchema,
} from "@signoff/domain/collection";
import { collectionLaneSchema } from "@signoff/domain/workbench";
import type { Context } from "hono";
import { z } from "zod";
import { readJsonBodyWithSize } from "../lib/http-body.js";
import { isLocalhost } from "../middleware/entry-control.js";
import {
	completeJob,
	publishRepository,
	registerJobRepositories,
	rejectRepository,
	stagePulls,
} from "../monitoring/publication.js";
import { claimJob, failJob, renewJob } from "../monitoring/scheduler.js";
import { MonitoringError, mapJob, readJob } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";
import { apiError } from "./query.js";

const now = () => Math.floor(Date.now() / 1000);
const id = (c: Context<AppEnv>) => c.req.param("id") ?? "";
function local(handler: (c: Context<AppEnv>) => Promise<Response>) {
	return async (c: Context<AppEnv>) => {
		if (!isLocalhost(c.req.header("host") ?? ""))
			return c.json(
				{ error: "Collector routes are only available on this machine" },
				403,
			);
		c.header("Cache-Control", "no-store");
		try {
			return await handler(c);
		} catch (error) {
			return apiError(
				error instanceof Error ? error : new Error(String(error)),
				c,
			);
		}
	};
}
async function body<T>(
	c: Context<AppEnv>,
	schema: z.ZodType<T>,
	limit = 8192,
): Promise<T> {
	const raw = await readJsonBodyWithSize(c, limit);
	if (!raw.ok)
		throw new MonitoringError(
			"INVALID_ARGUMENT",
			raw.error === "payload_too_large"
				? "Collector body is too large"
				: "Invalid JSON body",
			raw.error === "payload_too_large" ? 413 : 400,
		);
	return schema.parse(raw.value);
}

export const collectorHeartbeatRoute = local(async (c) => {
	const input = await body(c, collectorHeartbeatSchema);
	const timestamp = now();
	await c.env.DB.prepare(`INSERT INTO collector_heartbeat(id,last_seen_at,state,message) VALUES(1,?,?,?)
		ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,state=excluded.state,message=excluded.message`)
		.bind(timestamp, input.state, input.message)
		.run();
	return c.json({ lastSeenAt: timestamp, ...input });
});
export const collectorClaimRoute = local(async (c) => {
	const options = z
		.object({
			kind: z.enum(["list", "details"]).optional(),
			lane: collectionLaneSchema.optional(),
			jobId: z.string().min(1).max(240).optional(),
		})
		.strict()
		.parse(c.req.query());
	return c.json(
		await claimJob(c.env.DB, now(), {
			...options,
			source: c.env.SIGNOFF_DEMO_MODE === "1" ? undefined : "cli",
		}),
	);
});
export const collectorJobRoute = local(async (c) =>
	c.json(mapJob(await readJob(c.env.DB, id(c)))),
);
export const collectorProgressRoute = local(async (c) => {
	const input = await body(c, collectionProgressSchema);
	return c.json(
		mapJob(await renewJob(c.env.DB, id(c), input.leaseToken, now(), input)),
	);
});
export const collectorRepositoriesRoute = local(async (c) => {
	const input = await body(c, collectionRepositoriesSchema, 512 * 1024);
	return c.json(
		await registerJobRepositories(
			c.env.DB,
			id(c),
			input.leaseToken,
			input.repositories,
			now(),
		),
	);
});
export const collectorBatchRoute = local(async (c) => {
	const input = await body(c, collectionBatchSchema, 512 * 1024);
	await stagePulls(c.env.DB, id(c), input.leaseToken, input.pulls, now());
	return c.json({ accepted: input.pulls.length });
});
export const collectorPublishRoute = local(async (c) => {
	const input = await body(c, collectionPublishSchema, 512 * 1024);
	return c.json(
		mapJob(
			await publishRepository(
				c.env.DB,
				id(c),
				input.leaseToken,
				input.repositoryId,
				input.pullRequestCount,
				input.state,
				input.message,
				now(),
				input.mergeRequirements,
			),
		),
	);
});
export const collectorRepositoryFailRoute = local(async (c) => {
	const input = await body(c, collectionRepositoryFailureSchema);
	await rejectRepository(
		c.env.DB,
		id(c),
		input.leaseToken,
		input.repositoryId,
		input.message,
		now(),
	);
	return c.json({ recorded: true });
});
export const collectorCompleteRoute = local(async (c) => {
	const input = await body(c, collectionDoneSchema);
	return c.json(
		mapJob(await completeJob(c.env.DB, id(c), input.leaseToken, now())),
	);
});
export const collectorFailRoute = local(async (c) => {
	const input = await body(c, collectionFailureSchema);
	return c.json(
		mapJob(
			await failJob(
				c.env.DB,
				id(c),
				input.leaseToken,
				input.kind,
				input.message,
				now(),
			),
		),
	);
});
