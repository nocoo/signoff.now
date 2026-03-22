import { collectFiles } from "../core/files.ts";
import type { GitFiles } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export const filesCollector: Collector<GitFiles> = {
	name: "files",
	tier: "instant",
	async collect(ctx: CollectorContext): Promise<GitFiles> {
		const includeSlow = ctx.activeTiers.has("slow");
		return collectFiles(
			ctx.exec,
			ctx.fs,
			ctx.repoRoot,
			ctx.hasHead,
			includeSlow,
		);
	},
};
