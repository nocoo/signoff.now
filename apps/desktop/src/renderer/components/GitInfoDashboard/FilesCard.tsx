/**
 * FilesCard — tracked file stats, type distribution, largest files.
 */

import type { GitFiles } from "@signoff/gitinfo";
import { FileText } from "lucide-react";
import { useState } from "react";
import { BarChart } from "./BarChart";
import { DashboardCard } from "./DashboardCard";
import { formatBytes, formatNumber, StatNumber } from "./StatNumber";

interface FilesCardProps {
	files: GitFiles;
}

export function FilesCard({ files }: FilesCardProps) {
	const typeItems = Object.entries(files.typeDistribution)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 10)
		.map(([label, value]) => ({ label, value }));

	const churnItems = (files.mostChanged ?? [])
		.slice(0, 10)
		.map((f) => ({ label: f.path.split("/").pop() ?? f.path, value: f.count }));

	return (
		<DashboardCard title="Files" icon={<FileText className="h-4 w-4" />}>
			<div className="mb-3 flex gap-4">
				<StatNumber label="Tracked" value={formatNumber(files.trackedCount)} />
				<StatNumber
					label="Total lines"
					value={formatNumber(files.totalLines)}
				/>
				{files.binaryFiles && (
					<StatNumber label="Binary" value={files.binaryFiles.length} />
				)}
			</div>

			{/* Type distribution */}
			{typeItems.length > 0 && (
				<div className="mb-3">
					<h4 className="mb-2 text-xs font-medium text-muted-foreground">
						File types
					</h4>
					<BarChart items={typeItems} direction="horizontal" />
				</div>
			)}

			{/* Largest files */}
			{files.largestTracked.length > 0 && (
				<div className="mb-3">
					<h4 className="mb-2 text-xs font-medium text-muted-foreground">
						Largest files
					</h4>
					<div className="max-h-40 overflow-y-auto">
						<div className="flex flex-col gap-1">
							{files.largestTracked.slice(0, 10).map((f) => (
								<div key={f.path} className="flex items-center gap-2 text-xs">
									<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
										{f.path}
									</span>
									<span className="shrink-0 tabular-nums">
										{formatBytes(f.sizeBytes)}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Most changed files (slow tier) */}
			{churnItems.length > 0 && (
				<div className="mb-3">
					<h4 className="mb-2 text-xs font-medium text-muted-foreground">
						Most changed files
					</h4>
					<BarChart items={churnItems} direction="horizontal" />
				</div>
			)}

			{/* Largest blobs (slow tier) */}
			{files.largestBlobs && files.largestBlobs.length > 0 && (
				<div className="mb-3">
					<h4 className="mb-2 text-xs font-medium text-muted-foreground">
						Largest blobs
					</h4>
					<div className="max-h-40 overflow-y-auto">
						<div className="flex flex-col gap-1">
							{files.largestBlobs.slice(0, 10).map((b) => (
								<div key={b.sha} className="flex items-center gap-2 text-xs">
									<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
										{b.path}
									</span>
									<span className="shrink-0 tabular-nums">
										{formatBytes(b.sizeBytes)}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Binary files (slow tier) */}
			{files.binaryFiles && files.binaryFiles.length > 0 && (
				<BinaryFileList files={files.binaryFiles} />
			)}
		</DashboardCard>
	);
}

function BinaryFileList({ files }: { files: string[] }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				{expanded ? "▼" : "▶"} Binary files ({files.length})
			</button>
			{expanded && (
				<div className="mt-1 max-h-32 overflow-y-auto pl-3">
					{files.map((f) => (
						<div
							key={f}
							className="truncate font-mono text-xs text-muted-foreground"
						>
							{f}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
