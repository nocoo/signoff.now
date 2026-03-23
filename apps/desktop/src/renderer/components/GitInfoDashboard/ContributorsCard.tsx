/**
 * ContributorsCard — author list with commit counts and optional LOC stats.
 */

import type { GitContributors } from "@signoff/gitinfo";
import { Users } from "lucide-react";
import { BarChart } from "./BarChart";
import { DashboardCard } from "./DashboardCard";
import { StatNumber } from "./StatNumber";

interface ContributorsCardProps {
	contributors: GitContributors;
}

export function ContributorsCard({ contributors }: ContributorsCardProps) {
	const top10 = contributors.authors.slice(0, 10);
	const authorItems = top10.map((a) => ({
		label: a.name || a.email,
		value: a.commits,
	}));

	const statsMap = new Map(
		(contributors.authorStats ?? []).map((s) => [s.email, s]),
	);

	return (
		<DashboardCard title="Contributors" icon={<Users className="h-4 w-4" />}>
			<div className="mb-3 flex gap-4">
				<StatNumber label="Total authors" value={contributors.totalAuthors} />
				<StatNumber label="Active (90d)" value={contributors.activeRecent} />
			</div>

			{authorItems.length > 0 && (
				<div className="mb-3">
					<BarChart items={authorItems} direction="horizontal" />
				</div>
			)}

			{/* LOC stats if available (slow tier) */}
			{contributors.authorStats && contributors.authorStats.length > 0 && (
				<div className="max-h-40 overflow-y-auto">
					<div className="flex flex-col gap-1">
						{top10.map((a) => {
							const stats = statsMap.get(a.email);
							if (!stats) return null;
							return (
								<div key={a.email} className="flex items-center gap-2 text-xs">
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{a.name || a.email}
									</span>
									<span className="shrink-0 text-green-400">
										+{stats.linesAdded.toLocaleString()}
									</span>
									<span className="shrink-0 text-red-400">
										-{stats.linesDeleted.toLocaleString()}
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
