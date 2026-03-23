/**
 * BranchesTab — full local/remote branch tables with stats.
 */

import type { GitBranches } from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { cn } from "@signoff/ui/utils";
import { GitBranch } from "lucide-react";
import { DashboardCard } from "../DashboardCard";
import { relativeDate, StatNumber } from "../StatNumber";

interface BranchesTabProps {
	branches: GitBranches;
}

export function BranchesTab({ branches }: BranchesTabProps) {
	return (
		<div className="flex flex-col gap-6">
			{/* Stat row */}
			<div className="flex flex-wrap items-center gap-6">
				<StatNumber label="Local" value={branches.totalLocal} />
				<StatNumber label="Remote" value={branches.totalRemote} />
				{branches.current !== null && (
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-muted-foreground">Current</span>
						<span className="inline-flex items-center gap-1 text-lg font-semibold">
							<GitBranch className="h-4 w-4 text-primary" />
							{branches.current}
						</span>
					</div>
				)}
			</div>

			{/* Local branches table */}
			{branches.local.length > 0 && (
				<DashboardCard
					title="Local Branches"
					icon={<GitBranch className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Name</TableHead>
								<TableHead className="h-8 text-xs">Upstream</TableHead>
								<TableHead className="h-8 text-right text-xs">Ahead</TableHead>
								<TableHead className="h-8 text-right text-xs">Behind</TableHead>
								<TableHead className="h-8 text-center text-xs">
									Merged
								</TableHead>
								<TableHead className="h-8 text-right text-xs">
									Last Commit
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{branches.local.map((branch) => {
								const isCurrent = branch.name === branches.current;
								return (
									<TableRow key={branch.name}>
										<TableCell
											className={cn(
												"py-1.5 text-xs",
												isCurrent && "font-bold text-primary",
											)}
										>
											{branch.name}
										</TableCell>
										<TableCell className="py-1.5 text-xs text-muted-foreground">
											{branch.upstream ?? "—"}
										</TableCell>
										<TableCell className="py-1.5 text-right text-xs tabular-nums">
											{branch.aheadBehind !== null &&
											branch.aheadBehind.ahead > 0 ? (
												<span className="text-green-400">
													↑{branch.aheadBehind.ahead}
												</span>
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="py-1.5 text-right text-xs tabular-nums">
											{branch.aheadBehind !== null &&
											branch.aheadBehind.behind > 0 ? (
												<span className="text-red-400">
													↓{branch.aheadBehind.behind}
												</span>
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="py-1.5 text-center text-xs">
											{branch.isMerged === true ? (
												<span className="text-green-400">✓</span>
											) : (
												""
											)}
										</TableCell>
										<TableCell className="py-1.5 text-right text-xs text-muted-foreground">
											{relativeDate(branch.lastCommitDate)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</DashboardCard>
			)}

			{/* Remote branches */}
			{branches.remote.length > 0 && (
				<DashboardCard
					title="Remote Branches"
					icon={<GitBranch className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Name</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{branches.remote.map((name) => (
								<TableRow key={name}>
									<TableCell className="py-1 text-xs text-muted-foreground">
										{name}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</DashboardCard>
			)}
		</div>
	);
}
