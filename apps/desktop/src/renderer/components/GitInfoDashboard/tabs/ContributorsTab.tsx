/**
 * ContributorsTab — commit distribution chart + full author data table.
 */

import type { GitContributors } from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { Users } from "lucide-react";
import { BarChart } from "../BarChart";
import { DashboardCard } from "../DashboardCard";
import { StatNumber } from "../StatNumber";

interface ContributorsTabProps {
	contributors: GitContributors;
}

export function ContributorsTab({ contributors }: ContributorsTabProps) {
	const authorItems = contributors.authors.slice(0, 20).map((a) => ({
		label: a.name || a.email,
		value: a.commits,
	}));

	const statsMap = new Map(
		(contributors.authorStats ?? []).map((s) => [s.email, s]),
	);

	const hasLoc =
		!!contributors.authorStats && contributors.authorStats.length > 0;

	return (
		<div className="flex flex-col gap-6">
			{/* Stat row */}
			<div className="flex flex-wrap gap-6">
				<StatNumber label="Total authors" value={contributors.totalAuthors} />
				<StatNumber label="Active (90d)" value={contributors.activeRecent} />
			</div>

			{/* Commit distribution chart */}
			{authorItems.length > 0 && (
				<DashboardCard
					title="Commit Distribution"
					icon={<Users className="h-4 w-4" />}
				>
					<BarChart
						items={authorItems}
						direction="horizontal"
						maxItems={20}
						colorful
					/>
				</DashboardCard>
			)}

			{/* Full author table */}
			{contributors.authors.length > 0 && (
				<DashboardCard
					title="Author Details"
					icon={<Users className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-10 w-10 text-sm">#</TableHead>
								<TableHead className="h-10 text-sm">Name</TableHead>
								<TableHead className="h-10 text-sm">Email</TableHead>
								<TableHead className="h-10 text-right text-sm">
									Commits
								</TableHead>
								{hasLoc ? (
									<>
										<TableHead className="h-10 text-right text-sm">
											+Lines
										</TableHead>
										<TableHead className="h-10 text-right text-sm">
											-Lines
										</TableHead>
									</>
								) : null}
							</TableRow>
						</TableHeader>
						<TableBody>
							{contributors.authors.map((author, i) => {
								const stats = statsMap.get(author.email);
								return (
									<TableRow key={`${author.email}-${i}`}>
										<TableCell className="p-2 text-sm text-muted-foreground">
											{i + 1}
										</TableCell>
										<TableCell className="p-2 text-sm">
											{author.name || "—"}
										</TableCell>
										<TableCell className="p-2 font-mono text-sm text-muted-foreground">
											{author.email}
										</TableCell>
										<TableCell className="p-2 text-right text-sm tabular-nums">
											{author.commits.toLocaleString()}
										</TableCell>
										{hasLoc ? (
											<>
												<TableCell className="p-2 text-right text-sm tabular-nums text-green-400">
													{stats
														? `+${stats.linesAdded.toLocaleString()}`
														: "—"}
												</TableCell>
												<TableCell className="p-2 text-right text-sm tabular-nums text-red-400">
													{stats
														? `-${stats.linesDeleted.toLocaleString()}`
														: "—"}
												</TableCell>
											</>
										) : null}
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</DashboardCard>
			)}
		</div>
	);
}
