import { collectLogs } from "../core/logs.ts";
import type { GitLogs } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const logsCollector: Collector<GitLogs> = {
	name: "logs",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitLogs> {
		const includeSlow = ctx.activeTiers.has("slow");
		return collectLogs(ctx.exec, ctx.repoRoot, ctx.hasHead, includeSlow);
	},
};
