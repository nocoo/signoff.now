import { storageSource } from "@signoff/domain/monitoring";
import { jobHistoryFiltersSchema } from "@signoff/domain/query";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { isLocalhost } from "../middleware/entry-control.js";
import {
	lookupPull,
	parseQuery,
	queryCollector,
	queryJob,
	queryJobHistory,
	queryObservations,
	queryPull,
	queryPulls,
	queryRepos,
} from "../monitoring/query.js";
import { MonitoringError } from "../monitoring/store.js";
import type { AppEnv } from "../types.js";

export function apiError(error: unknown, c: Context<AppEnv>) {
	const known = error instanceof MonitoringError;
	const invalid =
		error instanceof z.ZodError ||
		error instanceof TypeError ||
		error instanceof URIError;
	const status = known ? error.status : invalid ? 400 : 503;
	return c.json(
		{
			error: {
				code: known
					? error.code
					: invalid
						? "INVALID_ARGUMENT"
						: "SERVICE_UNAVAILABLE",
				message: known
					? error.message
					: invalid
						? "Invalid request parameters"
						: "The cache service could not complete this request",
				retryable: status >= 500,
			},
		},
		status,
	);
}
export const queryRoutes = new Hono<AppEnv>();
queryRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});
queryRoutes.onError(apiError);
const now = () => Math.floor(Date.now() / 1000);
const parsed = (c: Context<AppEnv>) =>
	parseQuery(new URL(c.req.url).searchParams);
const scope = (c: Context<AppEnv>) => storageSource(parsed(c).source);
const lookupSchema = z.object({
	repositoryUrl: z.url(),
	number: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

queryRoutes.get("/repos", async (c) => {
	const f = parsed(c);
	return c.json(await queryRepos(c.env.DB, storageSource(f.source), f, now()));
});
queryRoutes.get("/prs", async (c) => {
	const f = parsed(c);
	return c.json(await queryPulls(c.env.DB, storageSource(f.source), f, now()));
});
queryRoutes.get("/prs/lookup", async (c) => {
	const q = lookupSchema.parse(c.req.query());
	return c.json(
		await lookupPull(c.env.DB, scope(c), q.repositoryUrl, q.number, now()),
	);
});
queryRoutes.get("/prs/:id", async (c) =>
	c.json(await queryPull(c.env.DB, scope(c), c.req.param("id"), now())),
);
queryRoutes.get("/observations", async (c) => {
	const f = parsed(c);
	return c.json(
		await queryObservations(c.env.DB, storageSource(f.source), f, now()),
	);
});
queryRoutes.get("/observations/lookup", async (c) => {
	const f = parsed(c);
	const pullId = c.req.query("pullId");
	const lookup = pullId ? { pullId } : lookupSchema.parse(c.req.query());
	return c.json(
		await queryObservations(
			c.env.DB,
			storageSource(f.source),
			f,
			now(),
			lookup,
		),
	);
});
queryRoutes.get("/collector", async (c) =>
	c.json({
		...(await queryCollector(c.env.DB, scope(c), now())),
		sampleCommandsEnabled:
			c.env.SIGNOFF_DEMO_MODE === "1" &&
			isLocalhost(c.req.header("host") ?? ""),
	}),
);
queryRoutes.get("/jobs", async (c) =>
	c.json(
		await queryJobHistory(
			c.env.DB,
			scope(c),
			jobHistoryFiltersSchema.parse(c.req.query()),
		),
	),
);
queryRoutes.get("/jobs/:id", async (c) =>
	c.json(await queryJob(c.env.DB, scope(c), c.req.param("id"))),
);
