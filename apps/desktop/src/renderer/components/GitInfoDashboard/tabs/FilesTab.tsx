/**
 * FilesTab — type distribution chart + file data tables.
 */

import type { GitFiles } from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { FileText } from "lucide-react";
import { BarChart } from "../BarChart";
import { DashboardCard } from "../DashboardCard";
import { formatBytes, formatNumber, StatNumber } from "../StatNumber";

interface FilesTabProps {
	files: GitFiles;
}

export function FilesTab({ files }: FilesTabProps) {
	const typeItems = Object.entries(files.typeDistribution)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 20)
		.map(([label, value]) => ({ label, value }));

	const churnItems = (files.mostChanged ?? [])
		.slice(0, 20)
		.map((f) => ({ label: f.path.split("/").pop() ?? f.path, value: f.count }));

	return (
		<div className="flex flex-col gap-6">
			{/* Stat row */}
			<div className="flex flex-wrap gap-6">
				<StatNumber label="Tracked" value={formatNumber(files.trackedCount)} />
				<StatNumber
					label="Total lines"
					value={formatNumber(files.totalLines)}
				/>
				{Array.isArray(files.binaryFiles) && (
					<StatNumber label="Binary" value={files.binaryFiles.length} />
				)}
			</div>

			{/* File type distribution chart */}
			{typeItems.length > 0 && (
				<DashboardCard
					title="File Type Distribution"
					icon={<FileText className="h-4 w-4" />}
				>
					<BarChart
						items={typeItems}
						direction="horizontal"
						maxItems={20}
						colorful
					/>
				</DashboardCard>
			)}

			{/* Largest tracked files table */}
			{files.largestTracked.length > 0 && (
				<DashboardCard
					title="Largest Tracked Files"
					icon={<FileText className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Path</TableHead>
								<TableHead className="h-8 text-right text-xs">Size</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{files.largestTracked.map((f) => (
								<TableRow key={f.path}>
									<TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
										{f.path}
									</TableCell>
									<TableCell className="py-1.5 text-right text-xs tabular-nums">
										{formatBytes(f.sizeBytes)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</DashboardCard>
			)}

			{/* Most changed files */}
			{churnItems.length > 0 && (
				<DashboardCard
					title="Most Changed Files"
					icon={<FileText className="h-4 w-4" />}
				>
					<div className="mb-4">
						<BarChart
							items={churnItems.slice(0, 10)}
							direction="horizontal"
							barColor="bg-amber-500/60"
						/>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Path</TableHead>
								<TableHead className="h-8 text-right text-xs">
									Changes
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(files.mostChanged ?? []).slice(0, 20).map((f) => (
								<TableRow key={f.path}>
									<TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
										{f.path}
									</TableCell>
									<TableCell className="py-1.5 text-right text-xs tabular-nums">
										{f.count.toLocaleString()}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</DashboardCard>
			)}

			{/* Largest blobs */}
			{files.largestBlobs && files.largestBlobs.length > 0 && (
				<DashboardCard
					title="Largest Blobs"
					icon={<FileText className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Path</TableHead>
								<TableHead className="h-8 text-xs">SHA</TableHead>
								<TableHead className="h-8 text-right text-xs">Size</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{files.largestBlobs.map((b) => (
								<TableRow key={b.sha}>
									<TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
										{b.path}
									</TableCell>
									<TableCell
										className="py-1.5 font-mono text-xs text-muted-foreground"
										title={b.sha}
									>
										{b.sha.slice(0, 7)}
									</TableCell>
									<TableCell className="py-1.5 text-right text-xs tabular-nums">
										{formatBytes(b.sizeBytes)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</DashboardCard>
			)}

			{/* Binary files */}
			{files.binaryFiles && files.binaryFiles.length > 0 && (
				<DashboardCard
					title="Binary Files"
					icon={<FileText className="h-4 w-4" />}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-8 text-xs">Path</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{files.binaryFiles.map((f) => (
								<TableRow key={f}>
									<TableCell className="py-1 font-mono text-xs text-muted-foreground">
										{f}
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
