/**
 * TagsTab — stat row + full tag table.
 */

import type { GitTags } from "@signoff/gitinfo";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@signoff/ui/table";
import { Tag } from "lucide-react";
import { DashboardCard } from "../DashboardCard";
import { relativeDate, StatNumber } from "../StatNumber";

interface TagsTabProps {
	tags: GitTags;
}

export function TagsTab({ tags }: TagsTabProps) {
	return (
		<div className="flex flex-col gap-6">
			{/* Stat row */}
			<div className="flex flex-wrap gap-6">
				<StatNumber label="Total" value={tags.count} />
				{tags.latestReachableTag !== null && (
					<StatNumber label="Latest" value={tags.latestReachableTag} />
				)}
				{tags.commitsSinceTag !== null && (
					<StatNumber label="Since tag" value={tags.commitsSinceTag} />
				)}
			</div>

			{/* Full tag table */}
			{tags.tags.length > 0 && (
				<DashboardCard title="All Tags" icon={<Tag className="h-4 w-4" />}>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="h-10 text-sm">Name</TableHead>
								<TableHead className="h-10 text-sm">Type</TableHead>
								<TableHead className="h-10 text-sm">Message</TableHead>
								<TableHead className="h-10 text-right text-sm">Date</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tags.tags.map((tag) => (
								<TableRow key={tag.name}>
									<TableCell className="p-2 text-sm font-medium">
										{tag.name}
									</TableCell>
									<TableCell className="p-2 text-sm">
										<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
											{tag.type}
										</span>
									</TableCell>
									<TableCell
										className="max-w-64 truncate p-2 text-sm text-muted-foreground"
										title={tag.message ?? undefined}
									>
										{tag.message ?? "—"}
									</TableCell>
									<TableCell className="p-2 text-right text-sm text-muted-foreground">
										{tag.date !== null ? relativeDate(tag.date) : "—"}
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
