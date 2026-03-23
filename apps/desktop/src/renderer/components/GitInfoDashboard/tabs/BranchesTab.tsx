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
						<span className="inline-flex items-center gap-1 text-sm font-semibold font-mono">
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
								<TableHead className="h-10 text-sm">Name</TableHead>
								<TableHead className="h-10 text-sm">Upstream</TableHead>
								<TableHead className="h-10 text-right text-sm">Ahead</TableHead>
								<TableHead className="h-10 text-right text-sm">
									Behind
								</TableHead>
								<TableHead className="h-10 text-center text-sm">
									Merged
								</TableHead>
								<TableHead className="h-10 text-right text-sm">
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
												"p-2 text-sm",
												isCurrent && "font-bold text-primary",
											)}
										>
											{branch.name}
										</TableCell>
										<TableCell className="p-2 text-sm text-muted-foreground">
											{branch.upstream ?? "—"}
										</TableCell>
										<TableCell className="p-2 text-right text-sm tabular-nums">
											{branch.aheadBehind !== null &&
											branch.aheadBehind.ahead > 0 ? (
												<span className="text-green-400">
													↑{branch.aheadBehind.ahead}
												</span>
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="p-2 text-right text-sm tabular-nums">
											{branch.aheadBehind !== null &&
											branch.aheadBehind.behind > 0 ? (
												<span className="text-red-400">
													↓{branch.aheadBehind.behind}
												</span>
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="p-2 text-center text-sm">
											{branch.isMerged === true ? (
												<span className="text-green-400">✓</span>
											) : (
												""
											)}
										</TableCell>
										<TableCell className="p-2 text-right text-sm text-muted-foreground">
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
								<TableHead className="h-10 text-sm">Name</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{branches.remote.map((name) => (
								<TableRow key={name}>
									<TableCell className="p-2 text-sm text-muted-foreground">
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
