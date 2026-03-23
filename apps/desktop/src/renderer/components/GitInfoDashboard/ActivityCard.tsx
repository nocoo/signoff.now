/**
 * ActivityCard — commit frequency charts (by day, hour, month) + conventional types.
 */

import type { GitLogs } from "@signoff/gitinfo";
import { Activity } from "lucide-react";
import { BarChart } from "./BarChart";
import { DashboardCard } from "./DashboardCard";
import { formatNumber, StatNumber } from "./StatNumber";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ActivityCardProps {
	logs: GitLogs;
}

export function ActivityCard({ logs }: ActivityCardProps) {
	const freq = logs.commitFrequency;
	const convTypes = logs.conventionalTypes;

	const dayItems = freq
		? DAY_LABELS.map((label) => ({
				label,
				value: freq.byDayOfWeek[label] ?? 0,
			}))
		: [];

	const hourItems = freq
		? Array.from({ length: 24 }, (_, i) => ({
				label: `${i}`,
				value: freq.byHour[String(i)] ?? 0,
			}))
		: [];

	const monthItems = freq
		? Object.entries(freq.byMonth)
				.sort(([a], [b]) => a.localeCompare(b))
				.slice(-12)
				.map(([label, value]) => ({ label: label.slice(2), value }))
		: [];

	const typeItems = convTypes
		? Object.entries(convTypes)
				.sort(([, a], [, b]) => b - a)
				.map(([label, value]) => ({ label, value }))
		: [];

	return (
		<DashboardCard title="Activity" icon={<Activity className="h-4 w-4" />}>
			<div className="mb-3 flex gap-4">
				<StatNumber
					label="Total commits"
					value={formatNumber(logs.totalCommits)}
				/>
				<StatNumber label="Merges" value={formatNumber(logs.totalMerges)} />
			</div>

			{freq !== null && (
				<div className="grid grid-cols-2 gap-4">
					{/* Day of week */}
					<div>
						<h4 className="mb-2 text-xs font-medium text-muted-foreground">
							By day of week
						</h4>
						<BarChart
							items={dayItems}
							direction="vertical"
							className="h-24"
							colorful
						/>
					</div>

					{/* By hour */}
					<div>
						<h4 className="mb-2 text-xs font-medium text-muted-foreground">
							By hour
						</h4>
						<BarChart
							items={hourItems}
							direction="vertical"
							className="h-24"
							barColor="bg-cyan-500/60"
						/>
					</div>

					{/* By month */}
					{monthItems.length > 0 && (
						<div className="col-span-2">
							<h4 className="mb-2 text-xs font-medium text-muted-foreground">
								By month (last 12)
							</h4>
							<BarChart
								items={monthItems}
								direction="vertical"
								className="h-20"
								barColor="bg-emerald-500/60"
							/>
						</div>
					)}
				</div>
			)}

			{/* Conventional commit types */}
			{typeItems.length > 0 && (
				<div className="mt-4">
					<h4 className="mb-2 text-xs font-medium text-muted-foreground">
						Conventional commit types
					</h4>
					<BarChart
						items={typeItems}
						direction="horizontal"
						maxItems={8}
						colorful
					/>
				</div>
			)}
		</DashboardCard>
	);
}
