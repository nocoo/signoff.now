import { collectBranches } from "../core/branches.ts";
import type { GitBranches } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const branchesCollector: Collector<GitBranches> = {
	name: "branches",
	tier: "moderate",
	async collect(ctx: CollectorContext): Promise<GitBranches> {
		return collectBranches(ctx.exec, ctx.repoRoot, ctx.hasHead);
	},
};
