/**
 * BranchesCard — local/remote branch counts + branch list with ahead/behind.
 */

import type { GitBranches } from "@signoff/gitinfo";
import { cn } from "@signoff/ui/utils";
import { GitBranch } from "lucide-react";
import { DashboardCard } from "./DashboardCard";
import { relativeDate, StatNumber } from "./StatNumber";

interface BranchesCardProps {
	branches: GitBranches;
}

export function BranchesCard({ branches }: BranchesCardProps) {
	const visible = branches.local.slice(0, 20);

	return (
		<DashboardCard title="Branches" icon={<GitBranch className="h-4 w-4" />}>
			<div className="mb-3 flex gap-4">
				<StatNumber label="Local" value={branches.totalLocal} />
				<StatNumber label="Remote" value={branches.totalRemote} />
			</div>

			{visible.length > 0 && (
				<div className="max-h-64 overflow-y-auto">
					<div className="flex flex-col gap-1">
						{visible.map((branch) => {
							const isCurrent = branch.name === branches.current;
							return (
								<div
									key={branch.name}
									className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
								>
									<span
										className={cn(
											"min-w-0 flex-1 truncate",
											isCurrent && "font-bold",
										)}
									>
										{branch.name}
									</span>
									{branch.aheadBehind && (
										<span className="shrink-0 tabular-nums text-muted-foreground">
											{branch.aheadBehind.ahead > 0 && (
												<span className="text-green-400">
													↑{branch.aheadBehind.ahead}
												</span>
											)}{" "}
											{branch.aheadBehind.behind > 0 && (
												<span className="text-red-400">
													↓{branch.aheadBehind.behind}
												</span>
											)}
										</span>
									)}
									{branch.isMerged && (
										<span className="text-green-400" title="Merged">
											✓
										</span>
									)}
									<span className="shrink-0 text-muted-foreground">
										{relativeDate(branch.lastCommitDate)}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</DashboardCard>
	);
}
