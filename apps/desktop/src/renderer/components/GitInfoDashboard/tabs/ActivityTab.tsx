/**
 * ActivityTab — commit frequency charts + raw frequency data tables.
 */

import type { GitLogs } from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { Activity } from "lucide-react";
import { BarChart } from "../BarChart";
import { DashboardCard } from "../DashboardCard";
import { formatNumber, relativeDate, StatNumber } from "../StatNumber";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ActivityTabProps {
	logs: GitLogs;
}

export function ActivityTab({ logs }: ActivityTabProps) {
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
		<div className="flex flex-col gap-6">
			{/* Stat row */}
			<div className="flex flex-wrap gap-6">
				<StatNumber
					label="Total commits"
					value={formatNumber(logs.totalCommits)}
				/>
				<StatNumber label="Merges" value={formatNumber(logs.totalMerges)} />
				{logs.firstCommitDate !== null && (
					<StatNumber
						label="First commit"
						value={relativeDate(logs.firstCommitDate)}
					/>
				)}
				{logs.lastCommit !== null && (
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-muted-foreground">Last commit</span>
						<span className="text-sm font-semibold font-mono tabular-nums">
							{relativeDate(logs.lastCommit.date)}
						</span>
						<span className="truncate text-xs text-muted-foreground">
							{logs.lastCommit.author}
						</span>
					</div>
				)}
			</div>

			{/* Charts */}
			{freq !== null && (
				<DashboardCard
					title="Commit Frequency"
					icon={<Activity className="h-4 w-4" />}
				>
					<div className="grid grid-cols-2 gap-4">
						<div>
							<h4 className="mb-2 text-sm font-medium text-muted-foreground">
								By day of week
							</h4>
							<BarChart
								items={dayItems}
								direction="vertical"
								className="h-32"
								colorful
							/>
						</div>
						<div>
							<h4 className="mb-2 text-sm font-medium text-muted-foreground">
								By hour
							</h4>
							<BarChart
								items={hourItems}
								direction="vertical"
								className="h-32"
								barColor="bg-cyan-500/60"
							/>
						</div>
						{monthItems.length > 0 && (
							<div className="col-span-2">
								<h4 className="mb-2 text-sm font-medium text-muted-foreground">
									By month (last 12)
								</h4>
								<BarChart
									items={monthItems}
									direction="vertical"
									className="h-28"
									barColor="bg-emerald-500/60"
								/>
							</div>
						)}
					</div>
				</DashboardCard>
			)}

			{/* Conventional commit types chart */}
			{typeItems.length > 0 && (
				<DashboardCard
					title="Conventional Commit Types"
					icon={<Activity className="h-4 w-4" />}
				>
					<BarChart items={typeItems} direction="horizontal" colorful />
				</DashboardCard>
			)}

			{/* Raw data tables */}
			{freq !== null && (
				<DashboardCard
					title="Raw Frequency Data"
					icon={<Activity className="h-4 w-4" />}
				>
					<div className="flex flex-col gap-4">
						{/* Day of week table */}
						<div>
							<h4 className="mb-1 text-sm font-medium text-muted-foreground">
								By day of week
							</h4>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="h-10 text-sm">Day</TableHead>
										<TableHead className="h-10 text-right text-sm">
											Commits
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{dayItems.map((item) => (
										<TableRow key={item.label}>
											<TableCell className="p-2 text-sm">
												{item.label}
											</TableCell>
											<TableCell className="p-2 text-right text-sm tabular-nums">
												{item.value.toLocaleString()}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>

						{/* Hour table */}
						<div>
							<h4 className="mb-1 text-sm font-medium text-muted-foreground">
								By hour
							</h4>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="h-10 text-sm">Hour</TableHead>
										<TableHead className="h-10 text-right text-sm">
											Commits
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{hourItems.map((item) => (
										<TableRow key={item.label}>
											<TableCell className="p-2 text-sm">
												{item.label}:00
											</TableCell>
											<TableCell className="p-2 text-right text-sm tabular-nums">
												{item.value.toLocaleString()}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>

						{/* Month table */}
						{monthItems.length > 0 && (
							<div>
								<h4 className="mb-1 text-sm font-medium text-muted-foreground">
									By month
								</h4>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="h-10 text-sm">Month</TableHead>
											<TableHead className="h-10 text-right text-sm">
												Commits
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{monthItems.map((item) => (
											<TableRow key={item.label}>
												<TableCell className="p-2 text-sm">
													{item.label}
												</TableCell>
												<TableCell className="p-2 text-right text-sm tabular-nums">
													{item.value.toLocaleString()}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}

						{/* Conventional types table */}
						{typeItems.length > 0 && (
							<div>
								<h4 className="mb-1 text-sm font-medium text-muted-foreground">
									Conventional types
								</h4>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="h-10 text-sm">Type</TableHead>
											<TableHead className="h-10 text-right text-sm">
												Count
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{typeItems.map((item) => (
											<TableRow key={item.label}>
												<TableCell className="p-2 text-sm">
													{item.label}
												</TableCell>
												<TableCell className="p-2 text-right text-sm tabular-nums">
													{item.value.toLocaleString()}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				</DashboardCard>
			)}
		</div>
	);
}
