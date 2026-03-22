import { collectMeta } from "../core/meta.ts";
import type { GitMeta } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const metaCollector: Collector<GitMeta> = {
	name: "meta",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitMeta> {
		return collectMeta(ctx.exec, ctx.repoRoot, ctx.hasHead);
	},
};
