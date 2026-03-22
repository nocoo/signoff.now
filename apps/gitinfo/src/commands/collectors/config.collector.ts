import { collectConfig } from "../core/config.ts";
import type { GitConfig } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const configCollector: Collector<GitConfig> = {
	name: "config",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitConfig> {
		return collectConfig(
			ctx.exec,
			ctx.fs,
			ctx.repoRoot,
			ctx.repoRoot,
			ctx.gitDir,
			ctx.gitPath,
		);
	},
};
