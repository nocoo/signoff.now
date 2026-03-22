import type { CommandExecutor, FsReader } from "../../executor/types.ts";
import type { CollectorTier } from "../types.ts";

export interface CollectorContext {
	exec: CommandExecutor;
	fs: FsReader;
	repoRoot: string;
	gitDir: string;
	gitPath: (name: string) => Promise<string>;
	hasHead: boolean;
	activeTiers: Set<CollectorTier>;
}

export interface Collector<T> {
	name: string;
	tier: CollectorTier;
	collect(ctx: CollectorContext): Promise<T>;
}
