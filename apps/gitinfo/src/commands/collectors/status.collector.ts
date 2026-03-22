import { collectStatus } from "../core/status.ts";
import type { GitStatus } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const statusCollector: Collector<GitStatus> = {
	name: "status",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitStatus> {
		return collectStatus(ctx.exec, ctx.fs, ctx.repoRoot, ctx.gitPath);
	},
};
