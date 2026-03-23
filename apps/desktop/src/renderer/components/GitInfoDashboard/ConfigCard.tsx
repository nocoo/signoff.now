/**
 * ConfigCard — Git config: object stats, hooks, worktrees, key config.
 */

import type { GitConfig } from "@signoff/gitinfo";
import { Settings } from "lucide-react";
import { INTERESTING_CONFIG_KEYS } from "./constants";
import { DashboardCard } from "./DashboardCard";
import { formatSize, StatNumber } from "./StatNumber";

interface ConfigCardProps {
	config: GitConfig;
}

export function ConfigCard({ config }: ConfigCardProps) {
	const obj = config.objectStats;
	const filteredConfig = INTERESTING_CONFIG_KEYS.flatMap((key) => {
		const values = config.localConfig[key];
		if (!values || values.length === 0) return [];
		return [{ key, value: values.join(", ") }];
	});

	return (
		<DashboardCard title="Config" icon={<Settings className="h-4 w-4" />}>
			<div className="mb-3 grid grid-cols-3 gap-3">
				<StatNumber label="Git dir" value={formatSize(config.gitDirSizeKiB)} />
				<StatNumber label="Worktrees" value={config.worktreeCount} />
				<StatNumber label="Loose objects" value={obj.count} />
				<StatNumber label="Packed objects" value={obj.inPack} />
				<StatNumber label="Pack files" value={obj.packs} />
				<StatNumber label="Pack size" value={formatSize(obj.sizePackKiB)} />
			</div>

			{obj.garbage > 0 && (
				<div className="mb-3 rounded bg-yellow-500/15 px-2 py-1 text-xs text-yellow-400">
					⚠ {obj.garbage} garbage object{obj.garbage > 1 ? "s" : ""} (
					{formatSize(obj.sizeGarbageKiB)})
				</div>
			)}

			{/* Hooks */}
			{config.hooks.length > 0 && (
				<div className="mb-3">
					<h4 className="mb-1 text-xs font-medium text-muted-foreground">
						Hooks
					</h4>
					<div className="flex flex-wrap gap-1">
						{config.hooks.map((hook) => (
							<span
								key={hook}
								className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
							>
								{hook}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Key config */}
			{filteredConfig.length > 0 && (
				<div>
					<h4 className="mb-1 text-xs font-medium text-muted-foreground">
						Key config
					</h4>
					<div className="flex flex-col gap-0.5">
						{filteredConfig.map(({ key, value }) => (
							<div key={key} className="flex gap-2 text-xs">
								<span className="shrink-0 font-mono text-muted-foreground">
									{key}
								</span>
								<span className="min-w-0 truncate">{value}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</DashboardCard>
	);
}
