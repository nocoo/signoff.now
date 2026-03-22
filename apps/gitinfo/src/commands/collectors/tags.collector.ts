import { collectTags } from "../core/tags.ts";
import type { GitTags } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const tagsCollector: Collector<GitTags> = {
	name: "tags",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitTags> {
		return collectTags(ctx.exec, ctx.repoRoot, ctx.hasHead);
	},
};
