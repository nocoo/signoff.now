import { collectContributors } from "../core/contributors.ts";
import type { GitContributors } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const contributorsCollector: Collector<GitContributors> = {
	name: "contributors",
	tier: "moderate",
	async collect(ctx: CollectorContext): Promise<GitContributors> {
		const includeSlow = ctx.activeTiers.has("slow");
		return collectContributors(
			ctx.exec,
			ctx.repoRoot,
			ctx.hasHead,
			includeSlow,
		);
	},
};
